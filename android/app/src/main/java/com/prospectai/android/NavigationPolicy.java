package com.prospectai.android;

import java.net.URI;
import java.util.Locale;

/** No suffix/substring allowlists: only the configured HTTPS origin stays inside. */
public final class NavigationPolicy {
    public enum Destination { INTERNAL, BROWSER, DIALER, EMAIL, WHATSAPP, BLOCKED }
    private final String host;

    public NavigationPolicy(String appUrl) {
        URI uri = URI.create(appUrl);
        if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null ||
                uri.getRawUserInfo() != null || !standardPort(uri)) {
            throw new IllegalArgumentException("A trusted HTTPS application origin is required");
        }
        host = uri.getHost().toLowerCase(Locale.ROOT);
    }

    private static boolean standardPort(URI uri) { return uri.getPort() == -1 || uri.getPort() == 443; }

    public Destination destination(String url) {
        if (url == null || url.length() > 8192 || url.chars().anyMatch(c -> c < 32 || c == 127)) return Destination.BLOCKED;
        final URI uri;
        try { uri = URI.create(url); } catch (IllegalArgumentException error) { return Destination.BLOCKED; }
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
        if (uri.getRawUserInfo() != null) return Destination.BLOCKED;
        switch (scheme) {
            case "https":
                if (uri.getHost() == null) return Destination.BLOCKED;
                if (host.equalsIgnoreCase(uri.getHost())) return standardPort(uri) ? Destination.INTERNAL : Destination.BLOCKED;
                return Destination.BROWSER;
            case "http":
                return uri.getHost() == null || host.equalsIgnoreCase(uri.getHost()) ? Destination.BLOCKED : Destination.BROWSER;
            case "tel": return uri.isOpaque() && uri.getRawSchemeSpecificPart().matches("[+0-9(). -]{3,40}") ? Destination.DIALER : Destination.BLOCKED;
            case "mailto": return uri.isOpaque() && !uri.getRawSchemeSpecificPart().isEmpty() ? Destination.EMAIL : Destination.BLOCKED;
            case "whatsapp":
                return "send".equals(uri.getHost()) && uri.getPort() == -1 ? Destination.WHATSAPP : Destination.BLOCKED;
            default: return Destination.BLOCKED;
        }
    }

    public boolean internal(String url) { return destination(url) == Destination.INTERNAL; }
    /** Keep the complete published contact; never strip or add phone digits. */
    public String externalUrl(String url) {
        Destination target = destination(url);
        return target == Destination.INTERNAL || target == Destination.BLOCKED ? null : url;
    }
    public String origin() { return "https://" + host; }
}
