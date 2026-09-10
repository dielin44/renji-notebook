package com.renji.notebook;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import android.app.Activity;
import android.content.ClipData;
import android.content.Intent;
import android.net.Uri;
import android.util.Log;

import androidx.test.ext.junit.rules.ActivityScenarioRule;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.junit.Before;
import org.junit.Rule;
import org.junit.Test;
import org.junit.runner.RunWith;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

@RunWith(AndroidJUnit4.class)
public class AppSmokeTest {
    @Rule
    public ActivityScenarioRule<MainActivity> activityRule =
        new ActivityScenarioRule<>(MainActivity.class);

    @Before
    public void waitForWebPage() throws Exception {
        AtomicReference<MainActivity> activityReference = new AtomicReference<>();
        activityRule.getScenario().onActivity(activityReference::set);
        MainActivity activity = activityReference.get();
        assertNotNull("Activity was not created", activity);
        assertTrue("WebView page did not finish loading",
            activity.awaitWebPageForTesting(45, TimeUnit.SECONDS));
        InstrumentationRegistry.getInstrumentation().waitForIdleSync();
    }

    private String evaluate(String script) throws Exception {
        CountDownLatch latch = new CountDownLatch(1);
        AtomicReference<String> result = new AtomicReference<>();
        activityRule.getScenario().onActivity(activity ->
            activity.getWebViewForTesting().evaluateJavascript(script, value -> {
                result.set(value);
                latch.countDown();
            })
        );
        assertTrue("JavaScript evaluation timed out for: " + script,
            latch.await(30, TimeUnit.SECONDS));
        return result.get();
    }

    private void runJs(String script) throws Exception {
        String result = evaluate("(function(){" + script + ";return true;})()");
        assertEquals("JavaScript failed: " + script, "true", result);
    }

    private void waitUntil(String condition) throws Exception {
        long deadline = System.currentTimeMillis() + 20000;
        while (System.currentTimeMillis() < deadline) {
            if ("true".equals(evaluate("Boolean(" + condition + ")"))) return;
            Thread.sleep(180);
        }
        String diagnostics = evaluate("JSON.stringify({" +
            "ready:document.readyState," +
            "sheetOpen:Boolean(document.getElementById('sheet')&&document.getElementById('sheet').open)," +
            "formId:document.querySelector('#sheet form')?document.querySelector('#sheet form').getAttribute('id'):''," +
            "formValid:document.querySelector('#sheet form')?document.querySelector('#sheet form').checkValidity():null," +
            "formError:(document.querySelector('[data-form-error]')||{}).innerText||''," +
            "saveLabel:(document.querySelector('[data-action=\\\"save-form\\\"]')||{}).innerText||''," +
            "saveDisabled:Boolean((document.querySelector('[data-action=\\\"save-form\\\"]')||{}).disabled)," +
            "toast:(document.getElementById('toast')||{}).innerText||''," +
            "storage:(window.RenjiStore&&window.RenjiStore.diagnostics)?window.RenjiStore.diagnostics():null," +
            "nativeState:(window.AndroidBridge&&window.AndroidBridge.loadState)?String(window.AndroidBridge.loadState()).slice(0,240):''" +
            "})");
        throw new AssertionError("Condition timed out: " + condition + " diagnostics=" + diagnostics);
    }

    private void mark(String step) {
        Log.i("RenjiTest", step);
    }

    @Test
    public void directButtonsCreateModifyAndDeleteData() throws Exception {
        mark("START");
        waitUntil("document.querySelector('[data-action=\"add-person\"]') !== null");

        runJs("document.querySelector('[data-action=\"add-person\"]').click()");
        waitUntil("document.getElementById('person-form') !== null");
        mark("PERSON_FORM_OPEN");
        runJs("var f=document.getElementById('person-form');f.elements.name.value='測試人物';f.elements.birthday.value='1987-01-15';f.elements.bloodType.value='O';f.elements.startScore.value='95';var raw=atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=');var bytes=Uint8Array.from(raw,function(c){return c.charCodeAt(0);});var file=new File([bytes],'avatar.png',{type:'image/png'});if(typeof DataTransfer==='function'){var dt=new DataTransfer();dt.items.add(file);f.elements.avatar.files=dt.files;}else{Object.defineProperty(f.elements.avatar,'files',{value:[file]});}");
        assertEquals("true", evaluate("document.getElementById('person-form').checkValidity()"));
        runJs("document.querySelector('#person-form [data-action=\"save-form\"]').click()");
        waitUntil("document.body.innerText.indexOf('測試人物') >= 0 && !document.getElementById('sheet').open");
        waitUntil("document.querySelector('.person-card [data-action=\"view-avatar\"] img') !== null");
        assertEquals("true", evaluate("Boolean(JSON.parse(window.AndroidBridge.loadState()).people.find(function(p){return p.name==='測試人物'&&p.birthday==='1987-01-15'&&p.zodiac==='摩羯座'&&p.bloodType==='O'&&p.avatar&&p.avatar.dataUrl;}))"));
        assertEquals("true", evaluate("document.querySelector('[aria-label=\"人物品質摘要\"]').innerText.indexOf('優質')>=0&&document.querySelector('[aria-label=\"人物品質摘要\"]').innerText.indexOf('劣質')>=0&&document.querySelector('[aria-label=\"人物品質摘要\"] .summary-item:nth-child(2) .summary-value').innerText==='1'"));
        runJs("document.querySelector('.person-card [data-action=\"view-avatar\"]').click()");
        waitUntil("document.querySelector('.avatar-viewer img') !== null");
        runJs("document.querySelector('[data-action=\"close-sheet\"]').click()");
        waitUntil("!document.getElementById('sheet').open");
        mark("PERSON_SAVED");

        runJs("var c=Array.from(document.querySelectorAll('.person-card')).find(function(x){return x.innerText.indexOf('測試人物')>=0;});c.querySelector('[data-action=\"show-person\"]').click()");
        waitUntil("document.querySelector('[data-action=\"edit-person\"]') !== null");
        assertEquals("true", evaluate("document.getElementById('sheet-content').innerText.indexOf('生日')>=0&&document.getElementById('sheet-content').innerText.indexOf('摩羯座')>=0&&document.getElementById('sheet-content').innerText.indexOf('O 型')>=0&&document.getElementById('sheet-content').innerText.indexOf('認識日期')<0"));
        runJs("document.querySelector('[data-action=\"edit-person\"]').click()");
        waitUntil("document.getElementById('person-form') !== null");
        runJs("var f=document.getElementById('person-form');f.elements.nickname.value='已修改';f.querySelector('[data-action=\"save-form\"]').click()");
        waitUntil("!document.getElementById('sheet').open");
        mark("PERSON_EDITED");

        mark("LOANS_NAV_BEFORE");
        runJs("document.querySelector('[data-action=\"nav\"][data-view=\"loans\"]').click()");
        mark("LOANS_NAV_AFTER");
        waitUntil("document.querySelector('[data-action=\"primary-add\"]') !== null");
        mark("LOANS_READY");
        runJs("document.querySelector('[data-action=\"primary-add\"]').click()");
        mark("LOAN_ADD_CLICKED");
        waitUntil("document.getElementById('loan-form') !== null");
        mark("LOAN_FORM_OPEN");
        runJs("var f=document.getElementById('loan-form');f.elements.title.value='測試借款';f.elements.amount.value='100';f.querySelector('[data-action=\"save-form\"]').click()");
        waitUntil("document.body.innerText.indexOf('測試借款') >= 0 && !document.getElementById('sheet').open");
        mark("LOAN_SAVED");
        waitUntil("document.querySelector('.loan-card [data-action=\"add-transaction\"]') !== null");
        runJs("document.querySelector('.loan-card [data-action=\"add-transaction\"]').click()");
        waitUntil("document.getElementById('transaction-form') !== null");
        mark("TRANSACTION_FORM_OPEN");
        runJs("var f=document.getElementById('transaction-form');f.elements.value.value='40';f.querySelector('[data-action=\"save-form\"]').click()");
        waitUntil("!document.getElementById('sheet').open");
        waitUntil("window.RenjiLogic.loanRemaining(JSON.parse(window.AndroidBridge.loadState()).loans.find(function(x){return x.title==='測試借款';})) === 60");
        runJs("document.querySelector('[data-action=\"nav\"][data-view=\"people\"]').click()");
        waitUntil("document.querySelector('.person-card [data-action=\"show-person-loans\"]') !== null");
        runJs("document.querySelector('.person-card [data-action=\"show-person-loans\"]').click()");
        waitUntil("document.getElementById('sheet-content').innerText.indexOf('借貸明細') >= 0");
        assertEquals("true", evaluate("document.querySelector('#sheet-content .sheet-head h2').innerText.indexOf('往來明細')<0"));
        runJs("document.querySelector('[data-action=\"close-sheet\"]').click()");
        waitUntil("!document.getElementById('sheet').open");
        mark("TRANSACTION_SAVED");

        runJs("document.querySelector('[data-action=\"nav\"][data-view=\"settings\"]').click()");
        waitUntil("document.querySelector('[data-action=\"add-category\"]') !== null");
        mark("SETTINGS_OPEN");
        assertEquals("true", evaluate("String(window.AndroidBridge.getStoragePath()).endsWith('renji-notebook-state.json')"));
        assertEquals("true", evaluate("document.querySelector('.storage-path-block code').innerText.indexOf('renji-notebook-state.json')>=0"));
        assertEquals("true", evaluate("document.body.innerText.indexOf('v1.0.4')>=0"));
        assertEquals("true", evaluate("document.querySelector('[data-action=\"edit-quick-tags\"]') !== null"));
        runJs("document.querySelector('[data-action=\"add-category\"]').click()");
        waitUntil("document.getElementById('category-form') !== null");
        runJs("var f=document.getElementById('category-form');f.elements.name.value='測試分類';f.querySelector('[data-action=\"save-form\"]').click()");
        waitUntil("document.body.innerText.indexOf('測試分類') >= 0 && !document.getElementById('sheet').open");

        runJs("var b=Array.from(document.querySelectorAll('[data-action=\"edit-category\"]')).find(function(x){return x.closest('.settings-line').innerText.indexOf('測試分類')>=0;});b.click()");
        waitUntil("document.getElementById('category-form') !== null");
        runJs("var f=document.getElementById('category-form');f.elements.name.value='分類已修改';f.querySelector('[data-action=\"save-form\"]').click()");
        waitUntil("document.body.innerText.indexOf('分類已修改') >= 0 && !document.getElementById('sheet').open");
        mark("CATEGORY_DONE");

        runJs("document.querySelector('[data-action=\"edit-quick-tags\"]').click()");
        waitUntil("document.getElementById('quick-tags-form') !== null");
        runJs("var f=document.getElementById('quick-tags-form');Array.from(f.elements.quickTags).forEach(function(x){x.checked=x.value==='需觀察';});f.querySelector('[data-action=\"save-form\"]').click()");
        waitUntil("!document.getElementById('sheet').open");
        assertEquals("true", evaluate("JSON.stringify(JSON.parse(window.AndroidBridge.loadState()).settings.quickTags)==='[\\\"需觀察\\\"]'"));

        runJs("document.querySelector('[data-action=\"nav\"][data-view=\"events\"]').click()");
        waitUntil("document.querySelector('[data-action=\"primary-add\"]') !== null");
        runJs("document.querySelector('[data-action=\"primary-add\"]').click()");
        waitUntil("document.getElementById('event-form') !== null");
        runJs("var f=document.getElementById('event-form');f.elements.title.value='主動守約';f.elements.deltaAmount.value='7';f.elements.important.checked=true;f.querySelector('[data-action=\"set-score-sign\"][data-sign=\"1\"]').click();f.querySelector('[data-action=\"save-form\"]').click()");
        waitUntil("document.body.innerText.indexOf('主動守約') >= 0 && !document.getElementById('sheet').open");
        mark("EVENT_SAVED");
        waitUntil("Boolean(Array.from(document.querySelectorAll('.event-card.important-event')).find(function(x){return x.innerText.indexOf('主動守約')>=0;}))");
        assertEquals("true", evaluate("getComputedStyle(Array.from(document.querySelectorAll('.event-card.important-event')).find(function(x){return x.innerText.indexOf('主動守約')>=0;})).borderColor!=='rgba(0, 0, 0, 0)'"));

        runJs("document.querySelector('[data-action=\"primary-add\"]').click()");
        waitUntil("document.getElementById('event-form') !== null");
        runJs("var f=document.getElementById('event-form');f.elements.title.value='違約扣分';f.elements.deltaAmount.value='3';f.querySelector('[data-action=\"set-score-sign\"][data-sign=\"-1\"]').click();f.querySelector('[data-action=\"save-form\"]').click()");
        waitUntil("document.body.innerText.indexOf('違約扣分') >= 0 && !document.getElementById('sheet').open");

        runJs("document.querySelector('[data-action=\"nav\"][data-view=\"people\"]').click()");
        waitUntil("Boolean(Array.from(document.querySelectorAll('.person-card')).find(function(x){return x.innerText.indexOf('測試人物')>=0;}))");
        assertEquals("true", evaluate("Boolean(Array.from(document.querySelectorAll('.quick-tags .chip')).find(function(x){return x.innerText==='需觀察';}))"));
        runJs("var c=Array.from(document.querySelectorAll('.person-card')).find(function(x){return x.innerText.indexOf('測試人物')>=0;});c.querySelector('[data-action=\"show-person\"]').click()");
        waitUntil("document.querySelector('[data-action=\"show-person-events\"]') !== null");
        runJs("document.querySelector('[data-action=\"show-person-events\"]').click()");
        waitUntil("document.querySelector('.subtabs.two-tabs') !== null");
        assertEquals("true", evaluate("document.getElementById('sheet-content').innerText.indexOf('往來明細')>=0&&document.getElementById('sheet-content').innerText.indexOf('加分 1')>=0&&document.getElementById('sheet-content').innerText.indexOf('扣分 1')>=0&&document.getElementById('sheet-content').innerText.indexOf('主動守約')>=0"));
        runJs("document.querySelector('[data-action=\"show-person-events\"][data-event-polarity=\"negative\"]').click()");
        waitUntil("document.getElementById('sheet-content').innerText.indexOf('違約扣分')>=0");
        assertEquals("true", evaluate("document.getElementById('sheet-content').innerText.indexOf('主動守約')<0"));
        runJs("document.querySelector('[data-action=\"close-sheet\"]').click();document.querySelector('[data-action=\"nav\"][data-view=\"events\"]').click()");
        waitUntil("Boolean(Array.from(document.querySelectorAll('.event-card')).find(function(x){return x.innerText.indexOf('主動守約')>=0;}))");

        runJs("var e=Array.from(document.querySelectorAll('.event-card')).find(function(x){return x.innerText.indexOf('主動守約')>=0;});e.click()");
        waitUntil("document.querySelector('[data-action=\"delete-event\"]') !== null");
        runJs("document.querySelector('[data-action=\"delete-event\"]').click()");
        waitUntil("document.getElementById('confirm-dialog').open");
        runJs("document.querySelector('[data-action=\"confirm-accept\"]').click()");
        waitUntil("document.body.innerText.indexOf('主動守約') < 0 && !document.getElementById('confirm-dialog').open");

        runJs("document.querySelector('[data-action=\"nav\"][data-view=\"settings\"]').click();document.querySelector('[data-action=\"set-pin\"]').click()");
        waitUntil("document.getElementById('pin-form') !== null");
        runJs("var f=document.getElementById('pin-form');f.elements.pin.value='2468';f.elements.confirmPin.value='2468';f.querySelector('[data-action=\"save-form\"]').click()");
        waitUntil("document.body.innerText.indexOf('已啟用') >= 0 && !document.getElementById('sheet').open");
        runJs("document.querySelector('[data-action=\"remove-pin\"]').click()");
        waitUntil("document.getElementById('confirm-dialog').open");
        runJs("document.querySelector('[data-action=\"confirm-accept\"]').click()");
        waitUntil("document.body.innerText.indexOf('未啟用') >= 0 && !document.getElementById('confirm-dialog').open");
        mark("PIN_DONE");

        runJs("document.querySelector('[data-action=\"clear-all\"]').click()");
        waitUntil("document.getElementById('confirm-dialog').open");
        runJs("document.querySelector('[data-action=\"confirm-accept\"]').click()");
        waitUntil("!document.getElementById('confirm-dialog').open");
        runJs("document.querySelector('[data-action=\"nav\"][data-view=\"people\"]').click()");
        waitUntil("document.body.innerText.indexOf('建立第一位人物') >= 0");
        mark("DONE");
    }

    @Test
    public void multiplePhotoUrisAreReturnedToWebView() {
        AtomicReference<Uri[]> result = new AtomicReference<>();
        activityRule.getScenario().onActivity(activity -> {
            Uri first = Uri.parse("content://test/photo-one");
            Uri second = Uri.parse("content://test/photo-two");
            ClipData clip = new ClipData("photos", new String[]{"image/jpeg"}, new ClipData.Item(first));
            clip.addItem(new ClipData.Item(second));
            Intent intent = new Intent();
            intent.setClipData(clip);
            result.set(activity.collectSelectedUris(Activity.RESULT_OK, intent));
        });
        assertNotNull(result.get());
        assertEquals(2, result.get().length);
    }
}
