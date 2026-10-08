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
downloads_fixture='''<!doctype html><html lang="en"><body><h1>Downloads</h1>
<ytd-rich-item-renderer><ytd-rich-grid-media><a href="/watch?v=aaaaaaaaaaa">Private fixture video title</a><ytd-menu-renderer><button aria-haspopup="true">Menu</button></ytd-menu-renderer></ytd-rich-grid-media></ytd-rich-item-renderer>
<ytd-rich-item-renderer><ytd-rich-grid-media><a href="/watch?v=bbbbbbbbbbb">Next fixture video title</a></ytd-rich-grid-media></ytd-rich-item-renderer>
</body></html>'''
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
            (ROOT/'extension/native-control.js').read_text()+"\n"+(ROOT/'extension/content.js').read_text()+"\n});")
    # The only navigated URL is intercepted. No live account or video is involved.
    context.route('https://www.youtube.com/**',lambda route:route.fulfill(status=200,content_type='text/html',body=downloads_fixture if '/feed/downloads' in route.request.url else fixture))
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
    def prepare_native(page):
        page.locator('ytd-playlist-panel-renderer #header').evaluate('(node)=>node.remove()')
        page.locator('[data-video-id="aaaaaaaaaaa"] ytd-menu-renderer').evaluate('(node)=>node.remove()')
        expect(page.locator('#yt-offline-remove-host #remove')).to_be_disabled()
        page.locator('#yt-offline-remove-host #native-check').click()
        expect(page.locator('#yt-offline-remove-host #remove')).to_be_enabled()
    def native_positive(page):
        count=len(context.pages)
        context.set_offline(True)
        try:
            prepare_native(page)
            assert page.evaluate('fixture.nativeRequests===0 && fixture.nativeAdds===0')
            click_confirm(page)
            expect(page.locator('#yt-offline-remove-host #status')).to_contain_text('persistent deletion has not been verified')
            expect(page).to_have_url('https://www.youtube.com/watch?v=aaaaaaaaaaa')
            assert page.evaluate('fixture.nativeRequests===1 && fixture.nativeAdds===0 && fixture.navigated===0')
            assert len(context.pages)==count and len(page.frames)==1
            assert page.evaluate('fixture.downloaded.aaaaaaaaaaa===false && fixture.downloaded.bbbbbbbbbbb===true')
        finally:
            context.set_offline(False)
    case('standalone native attempt never promotes UI transition to durable success or advances',native_positive)
    def native_message_interference(page):
        page.evaluate('() => {window.addEventListener("message",event=>event.stopImmediatePropagation(),true);window.postMessage=()=>{throw new Error("Fixture blocked postMessage")};}')
        native_positive(page)
    case('document bridge works when window message delivery is blocked',native_message_interference)
    def native_bridge_details(page):
        prepare_native(page)
        page.locator('#yt-offline-remove-host #details').click()
        text=page.locator('#yt-offline-remove-host pre').inner_text()
        report=json.loads(text)
        assert report['nativeBridge']=={'transport':'document-json-event','requestAcknowledged':True,'replyReceived':True,'adapterVersion':'0.1.7','adapterStage':'response-sent'}
        structure=report['nativeControlStructure']
        assert structure['bindingMatches'] and structure['removalLabelSeen'] and structure['eligibleNativeClickTarget']
        assert structure['formattedLabelCount']==1 and structure['nativeClickTargetCount']==1
        for private in ['aaaaaaaaaaa','bbbbbbbbbbb','youtube.com','Current video','videoId']:
            assert private not in text
        assert page.evaluate('fixture.nativeRequests===0 && fixture.nativeAdds===0')
    case('bridge stage diagnostics show acknowledgement and reply without private identifiers',native_bridge_details)
    def unsupported_structure(page,mode):
        page.evaluate('(mode)=>{fixture.nativeRenderMode=mode}',mode)
        page.locator('ytd-playlist-panel-renderer #header').evaluate('(node)=>node.remove()')
        page.locator('#yt-offline-remove-host #native-check').click()
        expect(page.locator('#yt-offline-remove-host #status')).to_contain_text('did not pass',timeout=15000)
        expect(page.locator('#yt-offline-remove-host #remove')).to_be_disabled()
        page.locator('#yt-offline-remove-host #details').click()
        text=page.locator('#yt-offline-remove-host pre').inner_text()
        report=json.loads(text)
        assert report['nativeControlStatus']=='unsupported'
        assert report['nativeBridge']['requestAcknowledged'] and report['nativeBridge']['replyReceived']
        structure=report['nativeControlStructure']
        assert structure['bindingMatches'] and structure['nativeClickTargetCount']==0
        assert not structure['eligibleNativeClickTarget']
        if mode=='empty':
            assert structure['directChildCount']==0 and structure['descendantCount']==0
            assert not structure['removalLabelSeen'] and structure['formattedLabelCount']==0
        else:
            assert structure['removalLabelSeen'] and structure['formattedLabelCount']==1
        for private in ['aaaaaaaaaaa','bbbbbbbbbbb','youtube.com','Current video','videoId']:
            assert private not in text
        assert page.evaluate('fixture.nativeRequests===0 && fixture.nativeAdds===0 && fixture.navigated===0')
    case('empty native renderer reports structure before cleanup without actions',lambda page:unsupported_structure(page,'empty'))
    case('native removal label without a click target is diagnosed and never enabled',lambda page:unsupported_structure(page,'no-click-target'))
    def multi_target_positive(page,mode,matching):
        page.evaluate('(mode)=>{fixture.nativeRenderMode=mode}',mode)
        prepare_native(page)
        page.locator('#yt-offline-remove-host #details').click()
        text=page.locator('#yt-offline-remove-host pre').inner_text()
        report=json.loads(text)
        structure=report['nativeControlStructure']
        assert structure['nativeClickTargetCount']==2
        assert structure['removalLabeledTargetCount']==matching
        assert structure['eligibleRemovalTargetCount']==1 and structure['eligibleNativeClickTarget']
        for private in ['aaaaaaaaaaa','bbbbbbbbbbb','youtube.com','Current video','videoId']:
            assert private not in text
        page.locator('#yt-offline-remove-host #close-details').click()
        assert page.evaluate('fixture.nativeRequests===0 && fixture.nativeOther===0')
        click_confirm(page)
        expect(page.locator('#yt-offline-remove-host #status')).to_contain_text('persistent deletion has not been verified')
        expect(page).to_have_url('https://www.youtube.com/watch?v=aaaaaaaaaaa')
        assert page.evaluate('fixture.nativeRequests===1 && fixture.nativeAdds===0 && fixture.nativeOther===0 && fixture.navigated===0')
    for mode,matching in [('two-targets',1),('hidden-duplicate',2),('disabled-duplicate',2)]:
        case('select unique eligible removal-label owner: '+mode,lambda page,m=mode,c=matching:multi_target_positive(page,m,c))
    def rejected_target(page,mode,eligible):
        page.evaluate('(mode)=>{fixture.nativeRenderMode=mode}',mode)
        page.locator('ytd-playlist-panel-renderer #header').evaluate('(node)=>node.remove()')
        page.locator('#yt-offline-remove-host #native-check').click()
        expect(page.locator('#yt-offline-remove-host #status')).to_contain_text('did not pass',timeout=15000)
        expect(page.locator('#yt-offline-remove-host #remove')).to_be_disabled()
        page.locator('#yt-offline-remove-host #details').click()
        report=json.loads(page.locator('#yt-offline-remove-host pre').inner_text())
        assert report['nativeControlStatus']=='unsupported'
        assert report['nativeControlStructure']['eligibleRemovalTargetCount']==eligible
        assert not report['nativeControlStructure']['eligibleNativeClickTarget']
        assert page.evaluate('fixture.nativeRequests===0 && fixture.nativeAdds===0 && fixture.nativeOther===0 && fixture.navigated===0')
    for mode,eligible in [('ambiguous-targets',2),('disabled-target',0),('hidden-target',0),('hidden-wrapper',0),('nested-target',0),('stray-label',0)]:
        case('reject ambiguous/ineligible/unowned removal label: '+mode,lambda page,m=mode,c=eligible:rejected_target(page,m,c))
    def changed_target(page):
        prepare_native(page)
        page.locator('#yt-offline-remove-host #remove').click()
        page.evaluate('() => {fixture.nativeRenderMode="ambiguous-targets"; document.querySelectorAll("ytd-menu-service-item-download-renderer").forEach(node=>node.refresh());}')
        page.locator('#yt-offline-remove-host #confirm').click()
        expect(page.locator('#yt-offline-remove-host #status')).to_contain_text('verification failed')
        assert page.evaluate('fixture.nativeRequests===0 && fixture.nativeAdds===0 && fixture.nativeOther===0 && fixture.navigated===0')
    case('revalidate unique eligible removal target immediately before confirmed click',changed_target)
    def native_bad_request(page):
        result=page.evaluate('''() => new Promise(resolve => {
          const nonce="invalidtarget0123456789";
          const listener=event=>{
            const data=JSON.parse(event.detail);
            if(data.nonce!==nonce||data.direction!=="response")return;
            document.removeEventListener("yt-offline-native-response-v2",listener,true);
            resolve(data.status);
          };
          document.addEventListener("yt-offline-native-response-v2",listener,true);
          document.dispatchEvent(new CustomEvent("yt-offline-native-request-v2",{detail:JSON.stringify({channel:"yt-offline-native-control-v1",direction:"request",nonce,operation:"remove",videoId:"bbbbbbbbbbb"})}));
        })''')
        assert result=='failed'
        assert page.evaluate('fixture.nativeRequests===0 && fixture.nativeAdds===0')
    case('document bridge explicitly rejects another-video removal without a click',native_bad_request)
    def native_cancel(page):
        prepare_native(page)
        page.locator('#yt-offline-remove-host #remove').click()
        page.locator('#yt-offline-remove-host #cancel').click()
        assert page.evaluate('fixture.nativeRequests===0 && fixture.nativeAdds===0')
    case('native confirmation Cancel never invokes native action',native_cancel)
    def native_untrusted_confirmation(page):
        prepare_native(page)
        page.locator('#yt-offline-remove-host #remove').click()
        page.locator('#yt-offline-remove-host #confirm').evaluate('(node)=>node.click()')
        expect(page.locator('#yt-offline-remove-host #status')).to_contain_text('No fresh user confirmation')
        assert page.evaluate('fixture.nativeRequests===0 && fixture.nativeAdds===0 && fixture.navigated===0')
    case('programmatic confirmation cannot authorize native removal',native_untrusted_confirmation)
    def native_not_downloaded(page):
        page.evaluate('fixture.downloaded.aaaaaaaaaaa=false')
        page.locator('ytd-playlist-panel-renderer').evaluate('(node)=>node.remove()')
        page.locator('#yt-offline-remove-host #native-check').click()
        expect(page.locator('#yt-offline-remove-host #status')).to_contain_text('offers Download, not removal')
        expect(page.locator('#yt-offline-remove-host #remove')).to_be_disabled()
        assert page.evaluate('fixture.nativeRequests===0 && fixture.nativeAdds===0')
    case('native adapter never clicks an Add Download control',native_not_downloaded)
    def native_unverified(page):
        page.evaluate('fixture.nativeWorks=false')
        prepare_native(page)
        click_confirm(page)
        expect(page.locator('#yt-offline-remove-host #status')).to_contain_text('could not be verified',timeout=15000)
        expect(page).to_have_url('https://www.youtube.com/watch?v=aaaaaaaaaaa')
        assert page.evaluate('fixture.nativeRequests===1 && fixture.nativeAdds===0 && fixture.navigated===0')
    case('unverified native removal is not retried and never advances',native_unverified)
    def optimistic_ui_survives(page):
        page.evaluate('fixture.nativeOptimisticOnly=true')
        prepare_native(page)
        click_confirm(page)
        expect(page.locator('#yt-offline-remove-host #status')).to_contain_text('persistent deletion has not been verified')
        expect(page).to_have_url('https://www.youtube.com/watch?v=aaaaaaaaaaa')
        assert page.evaluate('fixture.downloaded.aaaaaaaaaaa===true && fixture.nativeUiAbsent.aaaaaaaaaaa===true && fixture.nativeRequests===1 && fixture.navigated===0')
        page.locator('#yt-offline-remove-host #details').click()
        report=json.loads(page.locator('#yt-offline-remove-host pre').inner_text())
        assert report['nativeControlStatus']=='unverified'
        page.locator('#yt-offline-remove-host #close-details').click()
        page.evaluate('() => {fixture.nativeUiAbsent={}; document.querySelectorAll("ytd-menu-service-item-download-renderer").forEach(node=>node.refresh());}')
        assert page.evaluate('fixture.downloaded.aaaaaaaaaaa===true && fixture.nativeRequests===1 && fixture.navigated===0')
    case('optimistic labels in all controls do not prove durable removal when saved copy survives',optimistic_ui_survives)
    def native_next_missing(page):
        page.evaluate('fixture.downloaded.bbbbbbbbbbb=false')
        prepare_native(page)
        click_confirm(page)
        expect(page.locator('#yt-offline-remove-host #status')).to_contain_text('persistent deletion has not been verified')
        expect(page).to_have_url('https://www.youtube.com/watch?v=aaaaaaaaaaa')
        assert page.evaluate('fixture.nativeRequests===1 && fixture.nativeAdds===0 && fixture.navigated===0')
    case('native adapter never advances to a non-downloaded next video',native_next_missing)
    def native_changed_endpoint(page):
        prepare_native(page)
        page.evaluate('document.querySelector("ytd-menu-service-item-download-renderer").data={serviceEndpoint:{offlineVideoEndpoint:{videoId:"bbbbbbbbbbb"}}}')
        click_confirm(page)
        expect(page.locator('#yt-offline-remove-host #status')).to_contain_text('failed')
        assert page.evaluate('fixture.nativeRequests===0 && fixture.nativeAdds===0 && fixture.navigated===0')
    case('native adapter rejects a changed endpoint before destructive click',native_changed_endpoint)
    def native_changed_state(page):
        prepare_native(page)
        page.evaluate('fixture.downloaded.aaaaaaaaaaa=false;document.querySelectorAll("ytd-menu-service-item-download-renderer").forEach(node=>node.refresh())')
        click_confirm(page)
        expect(page.locator('#yt-offline-remove-host #status')).to_contain_text('failed')
        assert page.evaluate('fixture.nativeRequests===0 && fixture.nativeAdds===0 && fixture.navigated===0')
    case('native adapter rechecks removal label immediately before click',native_changed_state)
    def native_last(page):
        page.locator('[data-video-id="bbbbbbbbbbb"]').evaluate('(node)=>node.remove()')
        prepare_native(page)
        click_confirm(page)
        expect(page.locator('#yt-offline-remove-host #status')).to_contain_text('persistent deletion has not been verified')
        expect(page).to_have_url('https://www.youtube.com/watch?v=aaaaaaaaaaa')
        assert page.evaluate('fixture.nativeRequests===1 && fixture.nativeAdds===0 && fixture.navigated===0')
    case('native last download stays on the same page',native_last)
    def native_stale_dialog(page):
        prepare_native(page)
        page.locator('#yt-offline-remove-host #remove').click()
        page.evaluate('history.pushState({},"","/watch?v=bbbbbbbbbbb");document.dispatchEvent(new Event("yt-navigate-finish"))')
        expect(page.locator('#yt-offline-remove-host [role=dialog]')).to_have_count(0)
        assert page.evaluate('fixture.nativeRequests===0 && fixture.nativeAdds===0')
    case('native stale confirmation is cancelled on navigation',native_stale_dialog)
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
