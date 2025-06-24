"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.apiEndpoints = exports.getApiUrl = void 0;
// frontend/lib/api.ts
var getApiUrl = function () {
    // Usa la variable de entorno si existe
    if (process.env.NEXT_PUBLIC_API_URL) {
        return process.env.NEXT_PUBLIC_API_URL;
    }
    // En desarrollo, usa localhost:4000
    if (process.env.NODE_ENV === 'development') {
        return 'http://localhost:4000';
    }
    // En producción, deberás configurar esto en Easypanel
    return 'http://localhost:4000';
};
exports.getApiUrl = getApiUrl;
exports.apiEndpoints = {
    search: function () { return "".concat((0, exports.getApiUrl)(), "/search"); },
    visionAnalyze: function () { return "".concat((0, exports.getApiUrl)(), "/vision/analyze"); },
};
