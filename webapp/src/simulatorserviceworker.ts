interface ServiceWorkerEvent extends Event {
    waitUntil<U>(promise: Promise<U>): void;
    respondWith(response: Promise<Response>): void;
    request: Request;
}

interface SimWorkerOptions {
    urls?: string[];
}

interface SimWorkerContext {
    setSimulatorWorkerOptions: (opts: SimWorkerOptions) => void;
}

initSimulatorServiceWorker();

function initSimulatorServiceWorker() {
    // Empty string for released, otherwise contains the ref or version path
    const ref = `@relprefix@`.replace("---", "").replace(/^\//, "");

    // We don't do offline for version paths, only named releases

    // FIXME
    // const isNamedEndpoint = ref.indexOf("/") === -1;
    const isNamedEndpoint = true;

    // pxtRelId is replaced with the commit hash for this release
    const refCacheName = "makecode-sim;" + ref + ";@pxtRelId@";

    const simUrls = [
        // This is the URL loaded in the simulator iframe (includes ref)
        `@simUrl@`,

        `/cdn/bluebird.min.js`,
        `/cdn/pxtsim.js`,
        `/sim/sim.js`,
    ];

    const allFiles = simUrls.map(url => url.trim())
        .filter(url => !!url && url.indexOf("@") !== 0);

    // This function is called by workerConfig.js in the target to configure any
    // extra URLs that need to be cached
    (self as unknown as SimWorkerContext).setSimulatorWorkerOptions = opts => {
        if (opts && Array.isArray(opts.urls)) {
            allFiles.push(...resolveURLs(opts.urls));
        }
    }

    self.addEventListener("install", (ev: ServiceWorkerEvent) => {
        if (!isNamedEndpoint) {
            console.log("Skipping service worker install for unnamed endpoint");
            return;
        }

        // Check to see if there are any extra sim URLs to be cached by the target
        try {
            importScripts(`/sim/workerConfig.js`);
        }
        catch (e) {
            // This file is optional in the target, so ignore 404 response
            console.log("Failed to load target service worker config")
        }

        console.log("Installing service worker...")
        ev.waitUntil(caches.open(refCacheName)
            .then(cache => {
                console.log("Opened cache")
                return cache.addAll(dedupe(allFiles))
            }))
    });

    self.addEventListener("activate", (ev: ServiceWorkerEvent) => {
        if (!isNamedEndpoint) {
            console.log("Skipping service worker activate for unnamed endpoint");
            return;
        }

        console.log("Activating service worker...")
        ev.waitUntil(caches.keys()
            .then(cacheNames => {
                // Delete all caches that "belong" to this ref except for the current version
                const toDelete = cacheNames.filter(c => {
                    const cacheRef = getRefFromCacheName(c);
                    if (cacheRef === null || (cacheRef === ref && c !== refCacheName)) {
                        return true;
                    }
                    return false;
                })

                return  Promise.all(
                    toDelete.map(name => caches.delete(name))
                );
            }))
    });

    self.addEventListener("fetch", (ev: ServiceWorkerEvent) => {
        ev.respondWith(caches.match(ev.request)
            .then(response => {
                return response || fetch(ev.request)
            }))
    });

    function dedupe(urls: string[]) {
        const res: string[] = [];

        for (const url of urls) {
            if (res.indexOf(url) === -1) res.push(url)
        }

        return res;
    }

    function resolveURLs(urls: string[]) {
        const simPrefix = `/sim/`;
        const escapedSimPrefix = "/" + "sim" + "/";

        const cdnPrefix = `/cdn/`;
        const escapedCdnPrefix = "/" + "cdn" + "/";

        return dedupe(urls.map(url => url
            .replace(escapedSimPrefix, simPrefix)
            .replace(escapedCdnPrefix, cdnPrefix)
            .trim()
        ).filter(url => !!url));
    }

    function getRefFromCacheName(name: string) {
        const parts = name.split(";");

        if (parts.length !== 3) return null;

        return parts[1];
    }
}