/**
 * GM_xmlhttpRequest Implementation (Browser-Side)
 *
 * Relays cross-origin HTTP requests through the dev server at
 * `POST /__tmdev__/api/xhr` to bypass browser CORS restrictions.
 * This mirrors real TamperMonkey behavior where XHR requests are
 * made from the extension's privileged context.
 */

/** Details object passed to GM_xmlhttpRequest */
export interface GMXHRDetails {
  /** HTTP method (default: "GET") */
  method?: string;
  /** Target URL */
  url: string;
  /** Request headers */
  headers?: Record<string, string>;
  /** Request body */
  data?: string | FormData;
  /** Expected response type */
  responseType?: string;
  /** Timeout in milliseconds */
  timeout?: number;
  /** Called when the request completes successfully */
  onload?: (response: GMXHRResponse) => void;
  /** Called when the request fails */
  onerror?: (response: GMXHRResponse) => void;
  /** Called on download progress */
  onprogress?: (response: GMXHRResponse) => void;
  /** Called when the request times out */
  ontimeout?: (response: GMXHRResponse) => void;
  /** Called when readyState changes */
  onreadystatechange?: (response: GMXHRResponse) => void;
}

/** Response object passed to GM_xmlhttpRequest callbacks */
export interface GMXHRResponse {
  /** XHR-style readyState (4 = DONE) */
  readyState: number;
  /** Raw response headers as a single string */
  responseHeaders: string;
  /** Response body as text */
  responseText: string;
  /** Parsed response (depends on responseType) */
  response: unknown;
  /** HTTP status code */
  status: number;
  /** HTTP status text */
  statusText: string;
  /** Final URL after redirects */
  finalUrl: string;
}

/** Handle returned by GM_xmlhttpRequest for aborting */
export interface GMXHRAbortHandle {
  abort: () => void;
}

/**
 * Creates a GM_xmlhttpRequest function scoped to a specific script.
 *
 * The returned function relays all requests through `POST /__tmdev__/api/xhr`
 * on the dev server, which performs the actual HTTP request server-side
 * and returns the full response including headers.
 *
 * @param scriptId - Unique identifier for the calling script
 * @param connectDomains - Allowed domains from `@connect` metadata (informational;
 *                         actual enforcement happens server-side)
 * @returns A function matching TamperMonkey's GM_xmlhttpRequest signature
 */
export function createGMXmlHttpRequest(
  scriptId: string,
  connectDomains: string[],
): (details: GMXHRDetails) => GMXHRAbortHandle {
  return function GM_xmlhttpRequest(details: GMXHRDetails): GMXHRAbortHandle {
    const controller = new AbortController();

    // Notify readyState change: OPENED (1)
    if (details.onreadystatechange) {
      details.onreadystatechange(_buildResponse({ readyState: 1, url: details.url }));
    }

    // Serialize the request body -- FormData cannot be JSON-serialized,
    // so we convert it to a plain string representation if needed.
    let serializedData: string | null = null;
    if (details.data != null) {
      if (typeof details.data === 'string') {
        serializedData = details.data;
      } else {
        // FormData: convert to URL-encoded string
        const params = new URLSearchParams();
        details.data.forEach((value, key) => {
          params.append(key, String(value));
        });
        serializedData = params.toString();
      }
    }

    const payload = {
      scriptId,
      method: details.method || 'GET',
      url: details.url,
      headers: details.headers || {},
      data: serializedData,
      responseType: details.responseType || '',
      connectDomains,
    };

    // Notify readyState change: LOADING (3)
    if (details.onreadystatechange) {
      details.onreadystatechange(_buildResponse({ readyState: 3, url: details.url }));
    }

    // Set up the timeout if specified
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    if (details.timeout && details.timeout > 0) {
      timeoutId = setTimeout(() => {
        controller.abort();
        const timeoutResponse = _buildResponse({
          readyState: 4,
          status: 0,
          statusText: 'Timeout',
          url: details.url,
        });
        if (details.ontimeout) {
          details.ontimeout(timeoutResponse);
        }
        if (details.onreadystatechange) {
          details.onreadystatechange(timeoutResponse);
        }
      }, details.timeout);
    }

    // Execute the relay request
    fetch('/__tmdev__/api/xhr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
      .then(async (fetchResponse) => {
        if (timeoutId !== undefined) clearTimeout(timeoutId);

        const body = (await fetchResponse.json()) as {
          status?: number;
          statusText?: string;
          responseHeaders?: string;
          responseText?: string;
          finalUrl?: string;
          error?: string;
        };

        if (!fetchResponse.ok || body.error) {
          // Server-side error (e.g., network failure, domain not in @connect)
          const errorResponse = _buildResponse({
            readyState: 4,
            status: body.status ?? 0,
            statusText: body.statusText ?? body.error ?? 'Error',
            responseHeaders: body.responseHeaders ?? '',
            responseText: body.responseText ?? body.error ?? '',
            url: body.finalUrl ?? details.url,
          });
          if (details.onerror) {
            details.onerror(errorResponse);
          }
          if (details.onreadystatechange) {
            details.onreadystatechange(errorResponse);
          }
          return;
        }

        // Build success response
        const response = _buildResponse({
          readyState: 4,
          status: body.status ?? 200,
          statusText: body.statusText ?? 'OK',
          responseHeaders: body.responseHeaders ?? '',
          responseText: body.responseText ?? '',
          url: body.finalUrl ?? details.url,
          responseType: details.responseType,
        });

        // Progress callback with completed data
        if (details.onprogress) {
          details.onprogress(response);
        }

        // readyState change: DONE (4)
        if (details.onreadystatechange) {
          details.onreadystatechange(response);
        }

        // Final onload callback
        if (details.onload) {
          details.onload(response);
        }
      })
      .catch((err: unknown) => {
        if (timeoutId !== undefined) clearTimeout(timeoutId);

        // AbortError means the request was cancelled (abort() or timeout)
        if (err instanceof DOMException && err.name === 'AbortError') {
          return;
        }

        const errorResponse = _buildResponse({
          readyState: 4,
          status: 0,
          statusText: err instanceof Error ? err.message : 'Network Error',
          url: details.url,
        });

        if (details.onerror) {
          details.onerror(errorResponse);
        }
        if (details.onreadystatechange) {
          details.onreadystatechange(errorResponse);
        }
      });

    return {
      /** Abort the in-flight request */
      abort(): void {
        if (timeoutId !== undefined) clearTimeout(timeoutId);
        controller.abort();
      },
    };
  };
}

/**
 * Builds a GMXHRResponse with sensible defaults.
 */
function _buildResponse(opts: {
  readyState: number;
  status?: number;
  statusText?: string;
  responseHeaders?: string;
  responseText?: string;
  url: string;
  responseType?: string;
}): GMXHRResponse {
  const responseText = opts.responseText ?? '';
  let response: unknown = responseText;

  // Attempt to parse response based on responseType
  if (opts.responseType === 'json' && responseText) {
    try {
      response = JSON.parse(responseText);
    } catch {
      response = responseText;
    }
  }

  return {
    readyState: opts.readyState,
    responseHeaders: opts.responseHeaders ?? '',
    responseText,
    response,
    status: opts.status ?? 0,
    statusText: opts.statusText ?? '',
    finalUrl: opts.url,
  };
}
