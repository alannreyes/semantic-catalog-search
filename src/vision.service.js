"use strict";
var __esDecorate = (this && this.__esDecorate) || function (ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
    function accept(f) { if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected"); return f; }
    var kind = contextIn.kind, key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
    var target = !descriptorIn && ctor ? contextIn["static"] ? ctor : ctor.prototype : null;
    var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
    var _, done = false;
    for (var i = decorators.length - 1; i >= 0; i--) {
        var context = {};
        for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
        for (var p in contextIn.access) context.access[p] = contextIn.access[p];
        context.addInitializer = function (f) { if (done) throw new TypeError("Cannot add initializers after decoration has completed"); extraInitializers.push(accept(f || null)); };
        var result = (0, decorators[i])(kind === "accessor" ? { get: descriptor.get, set: descriptor.set } : descriptor[key], context);
        if (kind === "accessor") {
            if (result === void 0) continue;
            if (result === null || typeof result !== "object") throw new TypeError("Object expected");
            if (_ = accept(result.get)) descriptor.get = _;
            if (_ = accept(result.set)) descriptor.set = _;
            if (_ = accept(result.init)) initializers.unshift(_);
        }
        else if (_ = accept(result)) {
            if (kind === "field") initializers.unshift(_);
            else descriptor[key] = _;
        }
    }
    if (target) Object.defineProperty(target, contextIn.name, descriptor);
    done = true;
};
var __runInitializers = (this && this.__runInitializers) || function (thisArg, initializers, value) {
    var useValue = arguments.length > 2;
    for (var i = 0; i < initializers.length; i++) {
        value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
    }
    return useValue ? value : void 0;
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var __setFunctionName = (this && this.__setFunctionName) || function (f, name, prefix) {
    if (typeof name === "symbol") name = name.description ? "[".concat(name.description, "]") : "";
    return Object.defineProperty(f, "name", { configurable: true, value: prefix ? "".concat(prefix, " ", name) : name });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.VisionService = void 0;
var common_1 = require("@nestjs/common");
var openai_1 = require("openai");
var VisionService = function () {
    var _classDecorators = [(0, common_1.Injectable)()];
    var _classDescriptor;
    var _classExtraInitializers = [];
    var _classThis;
    var VisionService = _classThis = /** @class */ (function () {
        function VisionService_1(configService) {
            this.configService = configService;
            this.logger = new common_1.Logger(VisionService.name);
            this.openai = new openai_1.default({
                apiKey: this.configService.get('OPENAI_API_KEY'),
                timeout: 60000, // 60 segundos para imágenes
                maxRetries: 2,
            });
        }
        VisionService_1.prototype.analyzeProductImage = function (imageBuffer, mimeType) {
            return __awaiter(this, void 0, void 0, function () {
                var startTime, base64Image, dataUri, response, description, confidence, endTime, duration, error_1, endTime, duration;
                var _a, _b, _c;
                return __generator(this, function (_d) {
                    switch (_d.label) {
                        case 0:
                            startTime = process.hrtime.bigint();
                            _d.label = 1;
                        case 1:
                            _d.trys.push([1, 3, , 4]);
                            this.logger.log('Iniciando análisis de imagen con GPT-4 Vision');
                            base64Image = imageBuffer.toString('base64');
                            dataUri = "data:".concat(mimeType, ";base64,").concat(base64Image);
                            return [4 /*yield*/, this.openai.chat.completions.create({
                                    model: "gpt-4o",
                                    messages: [
                                        {
                                            role: "system",
                                            content: "Eres un experto en identificaci\u00F3n de productos industriales, herramientas y equipos. \n            Tu tarea es analizar la imagen y proporcionar \u00DANICAMENTE el nombre t\u00E9cnico del producto.\n            \n            Reglas:\n            - Identifica marca, modelo, tipo, tama\u00F1o y caracter\u00EDsticas visibles\n            - Usa terminolog\u00EDa t\u00E9cnica est\u00E1ndar de la industria\n            - S\u00E9 espec\u00EDfico pero conciso\n            - Si ves texto en la imagen, incl\u00FAyelo cuando sea relevante\n            - Responde SOLO con el nombre del producto, sin explicaciones adicionales\n            \n            Ejemplos de respuestas correctas:\n            - \"martillo carpintero stanley fatmax 20oz\"\n            - \"llave ajustable cromada 10 pulgadas\"\n            - \"taladro percutor bosch 850w azul\"\n            - \"casco seguridad 3m blanco ventilado\"\n            - \"guantes nitrilo negro talla l\"\n            \n            Si no puedes identificar el producto con certeza, responde: \"producto no identificado\""
                                        },
                                        {
                                            role: "user",
                                            content: [
                                                {
                                                    type: "image_url",
                                                    image_url: {
                                                        url: dataUri,
                                                        detail: "high" // Alta resolución para mejor identificación
                                                    }
                                                },
                                                {
                                                    type: "text",
                                                    text: "¿Qué producto es este?"
                                                }
                                            ]
                                        }
                                    ],
                                    temperature: 0.2,
                                    max_tokens: 100,
                                })];
                        case 2:
                            response = _d.sent();
                            description = ((_c = (_b = (_a = response.choices[0]) === null || _a === void 0 ? void 0 : _a.message) === null || _b === void 0 ? void 0 : _b.content) === null || _c === void 0 ? void 0 : _c.trim().toLowerCase()) || '';
                            confidence = description.includes('no identificado') ? 0.2 : 0.8;
                            endTime = process.hrtime.bigint();
                            duration = Number(endTime - startTime) / 1000000;
                            this.logger.log("An\u00E1lisis de imagen completado en ".concat(duration, "ms. Resultado: \"").concat(description, "\""));
                            return [2 /*return*/, {
                                    description: description,
                                    confidence: confidence
                                }];
                        case 3:
                            error_1 = _d.sent();
                            endTime = process.hrtime.bigint();
                            duration = Number(endTime - startTime) / 1000000;
                            this.logger.error("Error en an\u00E1lisis de imagen despu\u00E9s de ".concat(duration, "ms: ").concat(error_1.message), error_1.stack);
                            throw new Error("Error al analizar imagen: ".concat(error_1.message));
                        case 4: return [2 /*return*/];
                    }
                });
            });
        };
        return VisionService_1;
    }());
    __setFunctionName(_classThis, "VisionService");
    (function () {
        var _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(null) : void 0;
        __esDecorate(null, _classDescriptor = { value: _classThis }, _classDecorators, { kind: "class", name: _classThis.name, metadata: _metadata }, null, _classExtraInitializers);
        VisionService = _classThis = _classDescriptor.value;
        if (_metadata) Object.defineProperty(_classThis, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        __runInitializers(_classThis, _classExtraInitializers);
    })();
    return VisionService = _classThis;
}();
exports.VisionService = VisionService;
