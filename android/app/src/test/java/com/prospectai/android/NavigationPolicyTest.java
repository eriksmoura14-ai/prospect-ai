package com.prospectai.android;

import static org.junit.Assert.*;
import org.junit.Test;

public class NavigationPolicyTest {
    private final NavigationPolicy policy = new NavigationPolicy("https://prospect-ai-eriksmoura.netlify.app/");
    @Test public void keepsOnlyTheExactHttpsOrigin() {
        assertTrue(policy.internal("https://prospect-ai-eriksmoura.netlify.app/listas?pagina=2#saved"));
        assertTrue(policy.internal("https://prospect-ai-eriksmoura.netlify.app:443/"));
        assertFalse(policy.internal("https://prospect-ai-eriksmoura.netlify.app.evil.test/"));
        assertFalse(policy.internal("https://evilprospect-ai-eriksmoura.netlify.app/"));
        assertFalse(policy.internal("https://evil.test/?next=https://prospect-ai-eriksmoura.netlify.app/"));
    }
    @Test public void blocksCredentialsDowngradesAndDifferentPorts() {
        for (String url : new String[]{"https://user:pass@prospect-ai-eriksmoura.netlify.app/",
                "http://prospect-ai-eriksmoura.netlify.app/", "https://prospect-ai-eriksmoura.netlify.app:8443/"})
            assertEquals(NavigationPolicy.Destination.BLOCKED, policy.destination(url));
    }
    @Test public void preservesPublishedWhatsAppDigitsAndQueryExactly() {
        String url = "https://wa.me/5534998883900?text=Ol%C3%A1";
        assertEquals(NavigationPolicy.Destination.BROWSER, policy.destination(url));
        assertEquals("https://wa.me/5534998883900?text=Ol%C3%A1", policy.externalUrl(url));
        assertEquals("https://wa.me/553432249090", policy.externalUrl("https://wa.me/553432249090"));
        assertEquals(NavigationPolicy.Destination.WHATSAPP, policy.destination("whatsapp://send?phone=5534998883900"));
        assertEquals(NavigationPolicy.Destination.WHATSAPP, policy.destination("whatsapp://send?phone=553432249090"));
    }
    @Test public void allowsPublicWebsitesInTheBrowserOnly() {
        assertEquals(NavigationPolicy.Destination.BROWSER, policy.destination("https://example.org/empresa"));
        assertEquals(NavigationPolicy.Destination.BROWSER, policy.destination("http://example.org/"));
    }
    @Test public void blocksUntrustedNativeIntentsAndLocalContent() {
        for (String url : new String[]{"intent://send#Intent;scheme=whatsapp;end", "javascript:alert(1)",
                "file:///data/data/com.prospectai.android/", "content://contacts/1", "data:text/html,test",
                "blob:https://prospect-ai-eriksmoura.netlify.app/id", "whatsapp://evil?phone=123", "about:blank"})
            assertEquals(url, NavigationPolicy.Destination.BLOCKED, policy.destination(url));
    }
    @Test public void rejectsMalformedAndControlCharacterUrls() {
        for (String url : new String[]{null, "", "//example.org/", "https://", "https://example.org/\n", "https://example.org/\\path"})
            assertEquals(NavigationPolicy.Destination.BLOCKED, policy.destination(url));
    }
    @Test public void handlesDialAndEmailWithoutRewriting() {
        assertEquals(NavigationPolicy.Destination.DIALER, policy.destination("tel:+5534998883900"));
        assertEquals(NavigationPolicy.Destination.EMAIL, policy.destination("mailto:contato@example.org"));
        assertEquals(NavigationPolicy.Destination.BLOCKED, policy.destination("tel:*123%23"));
    }
}
