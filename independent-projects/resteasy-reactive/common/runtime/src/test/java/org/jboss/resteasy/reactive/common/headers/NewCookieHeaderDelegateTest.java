package org.jboss.resteasy.reactive.common.headers;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.Instant;
import java.util.Date;

import jakarta.ws.rs.core.NewCookie;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

public class NewCookieHeaderDelegateTest {

    @ParameterizedTest
    @CsvSource(delimiter = '|', value = {
            // IMF-fixdate, the format most servers send
            "Wed, 21 Oct 2015 07:28:00 GMT | 2015-10-21T07:28:00Z",
            // Netscape format with a two digit year, RFC 6265 pivot 00-69 -> 20xx
            "Mon, 11-Nov-24 22:59:57 GMT | 2024-11-11T22:59:57Z",
            // RFC 1036, RFC 6265 pivot 70-99 -> 19xx
            "Sunday, 06-Nov-94 08:49:37 GMT | 1994-11-06T08:49:37Z",
            // ANSI C asctime
            "Sun Nov  6 08:49:37 1994 | 1994-11-06T08:49:37Z",
            // Netscape format with a four digit year, the format this delegate itself emits
            "Mon, 11-Nov-2024 22:59:57 GMT | 2024-11-11T22:59:57Z" })
    public void parsesExpiresFormats(String expires, String expectedInstant) {
        NewCookie cookie = parse("c1=v1; Expires=" + expires + "; Path=/; Domain=example.com");
        assertEquals(Date.from(Instant.parse(expectedInstant)), cookie.getExpiry());
        assertEquals("/", cookie.getPath());
        assertEquals("example.com", cookie.getDomain());
    }

    @Test
    public void unparseableExpiresIsIgnored() {
        NewCookie cookie = parse("c1=v1; Expires=not-a-date; Path=/; Secure");
        assertNull(cookie.getExpiry());
        assertEquals("/", cookie.getPath());
        assertTrue(cookie.isSecure());
    }

    @Test
    public void expiryRoundTrips() {
        NewCookie cookie = parse("c1=v1; Expires=Wed, 21 Oct 2015 07:28:00 GMT; Path=/");
        NewCookie reparsed = parse(NewCookieHeaderDelegate.INSTANCE.toString(cookie));
        assertEquals(cookie.getExpiry(), reparsed.getExpiry());
    }

    private static NewCookie parse(String setCookie) {
        return (NewCookie) NewCookieHeaderDelegate.INSTANCE.fromString(setCookie);
    }
}
