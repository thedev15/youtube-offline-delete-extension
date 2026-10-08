"""All destructive actions target a deterministic fixture, never real YouTube downloads.

Chromium --extension loads a real unpacked MV3 extension. Other engines inject
the same scripts into the fixture: they validate DOM behavior, not addon loading.
"""
import argparse
import json
import os
from pathlib import Path
import tempfile
from playwright.sync_api import sync_playwright, expect
expect.set_options(timeout=10000)

ROOT=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser()
parser.add_argument('--browser',choices=['chromium','firefox','webkit'],default='chromium')
parser.add_argument('--extension',action='store_true')
args=parser.parse_args()
assert not args.extension or args.browser=='chromium'
out=ROOT/'test-results'/args.browser
out.mkdir(parents=True,exist_ok=True)
fixture=(ROOT/'tests/fixture.html').read_text()
results=[]
errors=[]

with sync_playwright() as p, tempfile.TemporaryDirectory(prefix='profile-',dir=out) as profile:
    engine=getattr(p,args.browser)
    if args.extension:
        extension=str(ROOT/'dist/chromium')
        context=engine.launch_persistent_context(profile,headless=True,executable_path=engine.executable_path,
            ignore_default_args=['--disable-extensions'],
            args=['--disable-extensions-except='+extension,'--load-extension='+extension],viewport={'width':1440,'height':900})
        browser=None
    else:
        browser=engine.launch(headless=True)
        context=browser.new_context(viewport={'width':1440,'height':900})
        context.add_init_script('window.browser={storage:{sync:{get:async()=>({}),set:async()=>{}},onChanged:{addListener:()=>{}}}};\n'+
            (ROOT/'extension/shared.js').read_text()+"\ndocument.addEventListener('DOMContentLoaded', () => {\n"+
            (ROOT/'extension/content.js').read_text()+"\n});")
    # The only navigated URL is intercepted. No live account or video is involved.
    context.route('https://www.youtube.com/**',lambda route:route.fulfill(status=200,content_type='text/html',body=fixture))
    context.set_default_timeout(10000)
    def fresh():
        page=context.new_page()
        page.on('pageerror',lambda error:errors.append(str(error)))
        page.goto('https://www.youtube.com/watch?v=aaaaaaaaaaa')
        expect(page.locator('#yt-offline-remove-host')).to_have_count(1)
        expect(page.locator('#yt-offline-remove-host #remove')).to_be_enabled()
        return page
    def click_confirm(page):
        page.locator('#yt-offline-remove-host #remove').click()
        expect(page.locator('#yt-offline-remove-host [role=dialog]')).to_be_visible()
        page.locator('#yt-offline-remove-host #confirm').click()
    def case(name,fn):
        page=fresh()
        try:
            fn(page)
            results.append({'name':name,'status':'PASS'})
            print('PASS '+name,flush=True)
        except Exception as error:
            results.append({'name':name,'status':'FAIL','error':str(error)})
            (out/'result.json').write_text(json.dumps({'status':'FAIL','cases':results,'errors':errors},indent=2)+'\n')
            page.screenshot(path=str(out/'failure.png'))
            raise
        finally:
            page.close()
    def placement(page):
        assert page.locator('ytd-watch-metadata #actions #yt-offline-remove-host').count()==1
        page.screenshot(path=str(out/'placement.png'))
    case('button in video action row',placement)
    def cancel(page):
        page.locator('#yt-offline-remove-host #remove').click()
        page.locator('#yt-offline-remove-host #cancel').click()
        assert page.evaluate('fixture.opened===0 && fixture.removed===0')
    case('Cancel never opens menu or removes',cancel)
    def positive(page):
        click_confirm(page)
        expect(page).to_have_url('https://www.youtube.com/watch?v=bbbbbbbbbbb')
        assert page.evaluate('fixture.opened===1 && fixture.removed===1 && fixture.wrong===0')
        assert page.evaluate('fixture.navigated===1')
        assert page.locator('[data-video-id="bbbbbbbbbbb"]').count()==1
        assert page.locator('[data-video-id="aaaaaaaaaaa"]').count()==0
    case('verified removal affects only current video then plays next',positive)
    def disabled_details(page):
        page.locator('ytd-playlist-panel-renderer #header').evaluate('(node)=>node.remove()')
        expect(page.locator('#yt-offline-remove-host #remove')).to_be_disabled()
        expect(page.locator('#yt-offline-remove-host #status')).to_contain_text('title/layout not recognized')
        page.locator('#yt-offline-remove-host #details').click()
        report=json.loads(page.locator('#yt-offline-remove-host pre').inner_text())
        assert report['panelCount']==1 and report['recognizedDownloadsPanelCount']==0
        assert report['matchingCurrentRowCount']==1
        text=json.dumps(report)
        for private_value in ['aaaaaaaaaaa','bbbbbbbbbbb','youtube.com','Current video']:
            assert private_value not in text
        page.keyboard.press('Tab')
        expect(page.locator('#yt-offline-remove-host pre')).to_be_focused()
        page.keyboard.press('Escape')
        expect(page.locator('#yt-offline-remove-host #details')).to_be_focused()
        assert page.evaluate('fixture.opened===0 && fixture.removed===0 && fixture.navigated===0')
    case('disabled button provides privacy-safe diagnostics without action',disabled_details)
    def class_heading(page):
        page.locator('ytd-playlist-panel-renderer #header').evaluate('(node)=>node.innerHTML="<div class=title>Downloads</div>"')
        expect(page.locator('#yt-offline-remove-host #remove')).to_be_enabled()
        positive(page)
    case('Downloads class-based heading is recognized',class_heading)
    def inaccessible_menu(page):
        page.locator('[data-video-id="aaaaaaaaaaa"] ytd-menu-renderer').evaluate('(node)=>node.remove()')
        expect(page.locator('#yt-offline-remove-host #remove')).to_be_disabled()
        expect(page.locator('#yt-offline-remove-host #status')).to_contain_text('no native menu')
        assert page.evaluate('fixture.opened===0 && fixture.removed===0')
    case('missing native menu explains disabled state without unsafe fallback',inaccessible_menu)
    def wrapper_menu(page):
        page.locator('[data-video-id="aaaaaaaaaaa"] ytd-menu-renderer button').evaluate('(node)=>{const wrapper=document.createElement("yt-icon-button");node.replaceWith(wrapper);wrapper.append(node);}')
        expect(page.locator('#yt-offline-remove-host #remove')).to_be_enabled()
        positive(page)
    case('native icon wrapper and inner button are counted only once',wrapper_menu)
    def modern_menu(page):
        page.evaluate('fixture.menuTag="yt-list-item-view-model"')
        positive(page)
    case('exact Downloads action on modern list-item renderer',modern_menu)
    def native_advance(page):
        page.evaluate('fixture.autoAdvance=true')
        click_confirm(page)
        expect(page).to_have_url('https://www.youtube.com/watch?v=bbbbbbbbbbb')
        expect(page.locator('[data-video-id="aaaaaaaaaaa"]')).to_have_count(0)
        assert page.evaluate('fixture.removed===1 && fixture.navigated===0')
    case('native next-video advance is not repeated',native_advance)
    def no_next(page):
        page.locator('[data-video-id="bbbbbbbbbbb"]').evaluate('(row)=>row.remove()')
        click_confirm(page)
        expect(page.locator('#yt-offline-remove-host #status')).to_have_text('Removed from Downloads.')
        expect(page).to_have_url('https://www.youtube.com/watch?v=aaaaaaaaaaa')
        assert page.evaluate('fixture.removed===1 && fixture.navigated===0')
    case('last download stays on page without wrapping',no_next)
    def rerender_without_removal(page):
        page.evaluate('fixture.removeWorks=false;document.addEventListener("click",e=>{if(e.target.closest("ytd-menu-service-item-renderer")?.textContent===fixture.label){const row=document.querySelector("[data-video-id=aaaaaaaaaaa]");row.replaceWith(row.cloneNode(true));}})')
        click_confirm(page)
        expect(page.locator('#yt-offline-remove-host #status')).to_contain_text('Removal could not be verified')
        expect(page).to_have_url('https://www.youtube.com/watch?v=aaaaaaaaaaa')
        assert page.evaluate('fixture.removed===1 && fixture.navigated===0')
    case('row rerender alone is not mistaken for removal and never skips',rerender_without_removal)
    def keyboard(page):
        page.locator('#yt-offline-remove-host #remove').click()
        expect(page.locator('#yt-offline-remove-host #cancel')).to_be_focused()
        page.keyboard.press('Tab')
        expect(page.locator('#yt-offline-remove-host #confirm')).to_be_focused()
        page.keyboard.press('Tab')
        expect(page.locator('#yt-offline-remove-host #cancel')).to_be_focused()
        page.keyboard.press('Escape')
        expect(page.locator('#yt-offline-remove-host [role=dialog]')).to_have_count(0)
        assert page.evaluate('fixture.removed===0')
    case('dialog focus trap and Escape cancellation',keyboard)
    def spa(page):
        page.evaluate("history.pushState({},'', '/watch?v=bbbbbbbbbbb');document.dispatchEvent(new Event('yt-navigate-finish'))")
        click_confirm(page)
        expect(page.locator('[data-video-id="bbbbbbbbbbb"]')).to_have_count(0)
        assert page.locator('[data-video-id="aaaaaaaaaaa"]').count()==1
        assert page.locator('#yt-offline-remove-host').count()==1
    case('SPA navigation targets new video without duplicate button',spa)
    def stale_dialog(page):
        page.locator('#yt-offline-remove-host #remove').click()
        page.evaluate("history.pushState({},'', '/watch?v=bbbbbbbbbbb');document.dispatchEvent(new Event('yt-navigate-finish'))")
        expect(page.locator('#yt-offline-remove-host [role=dialog]')).to_have_count(0)
        assert page.evaluate('fixture.removed===0')
    case('navigation cancels stale confirmation',stale_dialog)
    def absent(page):
        page.locator('ytd-playlist-panel-renderer').evaluate('(node)=>node.remove()')
        expect(page.locator('#yt-offline-remove-host #remove')).to_be_disabled()
        assert page.evaluate('fixture.removed===0')
    case('missing Downloads sidebar disables safely',absent)
    def unrelated(page):
        page.locator('ytd-playlist-panel-renderer #title').evaluate('(node)=>node.textContent="Watch later"')
        expect(page.locator('#yt-offline-remove-host #remove')).to_be_disabled()
    case('unrelated playlist is never targeted',unrelated)
    def duplicate(page):
        page.locator('[data-video-id="aaaaaaaaaaa"]').evaluate('(row)=>row.parentNode.append(row.cloneNode(true))')
        expect(page.locator('#yt-offline-remove-host #remove')).to_be_disabled()
    case('duplicate matching rows are rejected',duplicate)
    def generic(page):
        page.evaluate('fixture.label="Delete"')
        click_confirm(page)
        expect(page.locator('#yt-offline-remove-host #status')).to_contain_text('Removal could not be verified')
        assert page.evaluate('fixture.removed===0 && fixture.wrong===0')
        assert page.evaluate('fixture.navigated===0')
    case('generic Delete action is never clicked',generic)
    def ambiguous(page):
        page.evaluate("document.addEventListener('click',e=>{if(e.target.closest('ytd-menu-renderer button')){const menu=document.querySelector('ytd-menu-popup-renderer');menu.append(menu.lastElementChild.cloneNode(true));}})")
        click_confirm(page)
        expect(page.locator('#yt-offline-remove-host #status')).to_contain_text('Ambiguous')
        assert page.evaluate('fixture.removed===0')
    case('ambiguous native controls fail closed',ambiguous)
    def unverifiable(page):
        page.evaluate('fixture.removeWorks=false')
        click_confirm(page)
        expect(page.locator('#yt-offline-remove-host #status')).to_contain_text('Removal could not be verified')
        assert page.evaluate('fixture.removed===1')
        expect(page).to_have_url('https://www.youtube.com/watch?v=aaaaaaaaaaa')
        assert page.evaluate('fixture.navigated===0')
    case('unverified deletion is not reported successful or retried',unverifiable)
    def missing_row(page):
        page.locator('#yt-offline-remove-host #remove').click()
        page.locator('[data-video-id="aaaaaaaaaaa"]').evaluate('(row)=>row.remove()')
        page.locator('#yt-offline-remove-host #confirm').click()
        expect(page.locator('#yt-offline-remove-host #status')).to_contain_text('changed')
        assert page.evaluate('fixture.opened===0 && fixture.removed===0')
    case('row removed during confirmation is not acted on',missing_row)
    def shorts(page):
        page.evaluate("history.pushState({},'', '/shorts/aaaaaaaaaaa');document.dispatchEvent(new Event('yt-navigate-finish'))")
        expect(page.locator('#yt-offline-remove-host')).to_be_hidden()
    case('non-watch routes hide the button',shorts)
    def narrow(page):
        page.set_viewport_size({'width':640,'height':800})
        page.locator('#yt-offline-remove-host #remove').click()
        box=page.locator('#yt-offline-remove-host [role=dialog]').bounding_box()
        assert box and box['x']>=0 and box['x']+box['width']<=640
        page.screenshot(path=str(out/'narrow-dialog.png'))
        page.locator('#yt-offline-remove-host #cancel').click()
    case('narrow viewport dialog remains usable',narrow)
    assert not errors, errors
    report={'status':'PASS','browser':args.browser,'actual_extension_loaded':args.extension,
            'cases':results,'errors':errors,'scope':'Simulated native YouTube DOM only; no real downloads removed or authenticated YouTube behavior certified.'}
    (out/'result.json').write_text(json.dumps(report,indent=2)+'\n')
    context.close()
    if browser:browser.close()
    print(json.dumps({'status':'PASS','cases':len(results),'browser':args.browser,'actual_extension_loaded':args.extension}),flush=True)
