(() => {
    const apiBaseUrl = (window.API_BASE_URL || '').replace(/\/+$/, '');
    const tokenKey = 'mi-iglesia-token';

    window.MiIglesia = {
        async request(path, options = {}) {
            const headers = new Headers(options.headers || {});
            const token = localStorage.getItem(tokenKey);

            if (options.body && !(options.body instanceof FormData)) {
                headers.set('Content-Type', 'application/json');
            }
            if (token) {
                headers.set('Authorization', `Bearer ${token}`);
            }

            const response = await fetch(`${apiBaseUrl}${path}`, {
                ...options,
                headers
            });
            const result = await response.json();

            if (!response.ok) {
                const error = new Error(result.message || 'No se pudo completar la solicitud.');
                error.status = response.status;
                throw error;
            }

            return result;
        },
        saveToken(token) {
            localStorage.setItem(tokenKey, token);
        },
        hasToken() {
            return Boolean(localStorage.getItem(tokenKey));
        },
        clearToken() {
            localStorage.removeItem(tokenKey);
        }
    };
})();
