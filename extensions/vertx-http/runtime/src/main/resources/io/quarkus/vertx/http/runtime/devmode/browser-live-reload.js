// Quarkus development mode: reload the page, or a changed style sheet, when a static resource changes
(function () {
    var unloading = false;
    window.addEventListener("beforeunload", function () { unloading = true; });

    var source = new EventSource("${eventStreamPath}");
    source.addEventListener("connected", function () {
        console.debug("Quarkus live reload connected");
    });
    source.addEventListener("change", function (event) {
        if (unloading || !event.data) {
            return;
        }
        var change = JSON.parse(event.data);
        var styleSheetsOnly = change.others.length === 0 && change.staticResources.length > 0
                && change.staticResources.every(function (path) { return path.endsWith(".css"); });
        if (!styleSheetsOnly) {
            console.debug("Quarkus live reload: reloading the page");
            source.close();
            location.reload();
            return;
        }
        var links = document.querySelectorAll("link[rel='stylesheet']");
        change.staticResources.forEach(function (path) {
            links.forEach(function (link) {
                var url = new URL(link.href, location.href);
                if (url.host !== location.host || !url.pathname.endsWith(path)) {
                    return;
                }
                console.debug("Quarkus live reload: refreshing " + path);
                var refreshed = link.cloneNode();
                url.searchParams.set("live-reload", Date.now().toString());
                refreshed.href = url.toString();
                refreshed.onload = function () { link.remove(); };
                refreshed.onerror = function () { refreshed.remove(); };
                link.parentNode.insertBefore(refreshed, link.nextSibling);
            });
        });
    });
})();
