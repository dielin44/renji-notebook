package com.renji.notebook;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import android.app.Activity;
import android.content.ClipData;
import android.content.Intent;
import android.net.Uri;

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
        evaluate("(function(){" + script + ";return true;})()");
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

    @Test
    public void directButtonsCreateModifyAndDeleteData() throws Exception {
        waitUntil("document.querySelector('[data-action=\"add-person\"]') !== null");

        runJs("document.querySelector('[data-action=\"add-person\"]').click()");
        waitUntil("document.getElementById('person-form') !== null");
        runJs("var f=document.getElementById('person-form');f.elements.name.value='測試人物'");
        assertEquals("true", evaluate("document.getElementById('person-form').checkValidity()"));
        runJs("document.querySelector('#person-form [data-action=\"save-form\"]').click()");
        waitUntil("document.body.innerText.indexOf('測試人物') >= 0 && !document.getElementById('sheet').open");

        runJs("var c=Array.from(document.querySelectorAll('.person-card')).find(function(x){return x.innerText.indexOf('測試人物')>=0;});c.querySelector('[data-action=\"show-person\"]').click()");
        waitUntil("document.querySelector('[data-action=\"edit-person\"]') !== null");
        runJs("document.querySelector('[data-action=\"edit-person\"]').click()");
        waitUntil("document.getElementById('person-form') !== null");
        runJs("var f=document.getElementById('person-form');f.elements.nickname.value='已修改';f.querySelector('[data-action=\"save-form\"]').click()");
        waitUntil("!document.getElementById('sheet').open");

        runJs("document.querySelector('[data-action=\"nav\"][data-view=\"settings\"]').click()");
        waitUntil("document.querySelector('[data-action=\"add-category\"]') !== null");
        runJs("document.querySelector('[data-action=\"add-category\"]').click()");
        waitUntil("document.getElementById('category-form') !== null");
        runJs("var f=document.getElementById('category-form');f.elements.name.value='測試分類';f.querySelector('[data-action=\"save-form\"]').click()");
        waitUntil("document.body.innerText.indexOf('測試分類') >= 0 && !document.getElementById('sheet').open");

        runJs("var b=Array.from(document.querySelectorAll('[data-action=\"edit-category\"]')).find(function(x){return x.closest('.settings-line').innerText.indexOf('測試分類')>=0;});b.click()");
        waitUntil("document.getElementById('category-form') !== null");
        runJs("var f=document.getElementById('category-form');f.elements.name.value='分類已修改';f.querySelector('[data-action=\"save-form\"]').click()");
        waitUntil("document.body.innerText.indexOf('分類已修改') >= 0 && !document.getElementById('sheet').open");

        runJs("document.querySelector('[data-action=\"nav\"][data-view=\"events\"]').click()");
        waitUntil("document.querySelector('[data-action=\"primary-add\"]') !== null");
        runJs("document.querySelector('[data-action=\"primary-add\"]').click()");
        waitUntil("document.getElementById('event-form') !== null");
        runJs("var f=document.getElementById('event-form');f.elements.title.value='主動守約';f.elements.deltaAmount.value='7';f.querySelector('[data-action=\"set-score-sign\"][data-sign=\"1\"]').click();f.querySelector('[data-action=\"save-form\"]').click()");
        waitUntil("document.body.innerText.indexOf('主動守約') >= 0 && !document.getElementById('sheet').open");

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

        runJs("document.querySelector('[data-action=\"clear-all\"]').click()");
        waitUntil("document.getElementById('confirm-dialog').open");
        runJs("document.querySelector('[data-action=\"confirm-accept\"]').click()");
        waitUntil("!document.getElementById('confirm-dialog').open");
        runJs("document.querySelector('[data-action=\"nav\"][data-view=\"people\"]').click()");
        waitUntil("document.body.innerText.indexOf('建立第一位人物') >= 0");
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
