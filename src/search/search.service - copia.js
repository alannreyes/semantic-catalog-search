"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
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
exports.SearchService = void 0;
var common_1 = require("@nestjs/common");
var pg_1 = require("pg");
var openai_1 = require("openai");
var SearchService = function () {
    var _classDecorators = [(0, common_1.Injectable)()];
    var _classDescriptor;
    var _classExtraInitializers = [];
    var _classThis;
    var SearchService = _classThis = /** @class */ (function () {
        function SearchService_1(configService) {
            this.configService = configService;
            this.logger = new common_1.Logger(SearchService.name);
            this.pool = new pg_1.Pool({
                connectionString: this.configService.get('DATABASE_URL'),
            });
            this.openai = new openai_1.default({
                apiKey: this.configService.get('OPENAI_API_KEY'),
            });
            this.probes = parseInt(this.configService.get('PGVECTOR_PROBES') || '1', 10);
            this.embeddingModel = this.configService.get('OPENAI_MODEL') || 'text-embedding-3-small';
            this.productTable = this.configService.get('PRODUCT_TABLE') || 'productos_small';
            this.logger.log("SearchService initialized with model=".concat(this.embeddingModel, ", probes=").concat(this.probes, ", table=").concat(this.productTable));
        }
        SearchService_1.prototype.searchProducts = function (query_1) {
            return __awaiter(this, arguments, void 0, function (query, limit) {
                var initialResult, normalizedQuery, resultAfterNormalization, error_1;
                if (limit === void 0) { limit = 5; }
                return __generator(this, function (_a) {
                    switch (_a.label) {
                        case 0:
                            _a.trys.push([0, 4, , 5]);
                            this.logger.log("Buscando productos con query original: \"".concat(query, "\""));
                            return [4 /*yield*/, this.performSemanticSearch(query, limit)];
                        case 1:
                            initialResult = _a.sent();
                            if (["EXACTO", "EQUIVALENTE"].includes(initialResult.similitud)) {
                                this.logger.log("Similitud alta detectada (".concat(initialResult.similitud, "), no se requiere b\u00FAsqueda web"));
                                return [2 /*return*/, __assign(__assign({}, initialResult), { normalizado: null })];
                            }
                            this.logger.log("Similitud baja (".concat(initialResult.similitud, "), activando b\u00FAsqueda web para normalizaci\u00F3n"));
                            return [4 /*yield*/, this.normalizeQueryWithWebSearch(query)];
                        case 2:
                            normalizedQuery = _a.sent();
                            return [4 /*yield*/, this.performSemanticSearch(normalizedQuery, limit, query)];
                        case 3:
                            resultAfterNormalization = _a.sent();
                            return [2 /*return*/, __assign(__assign({}, resultAfterNormalization), { normalizado: normalizedQuery })];
                        case 4:
                            error_1 = _a.sent();
                            this.logger.error("Error en b\u00FAsqueda general: ".concat(error_1.message), error_1.stack);
                            throw new Error("Error en b\u00FAsqueda sem\u00E1ntica: ".concat(error_1.message));
                        case 5: return [2 /*return*/];
                    }
                });
            });
        };
        SearchService_1.prototype.performSemanticSearch = function (inputText_1) {
            return __awaiter(this, arguments, void 0, function (inputText, limit, originalQueryOverride) {
                var embeddingResponse, embedding, vectorString, result, best;
                if (limit === void 0) { limit = 5; }
                return __generator(this, function (_a) {
                    switch (_a.label) {
                        case 0: return [4 /*yield*/, this.openai.embeddings.create({
                                model: this.embeddingModel,
                                input: inputText,
                            })];
                        case 1:
                            embeddingResponse = _a.sent();
                            embedding = embeddingResponse.data[0].embedding;
                            if (!Array.isArray(embedding)) {
                                this.logger.warn('El embedding no es un array, intentando convertir...');
                                try {
                                    if (typeof embedding === 'object') {
                                        embedding = Object.values(embedding);
                                    }
                                    else if (typeof embedding === 'string') {
                                        embedding = JSON.parse(embedding);
                                    }
                                }
                                catch (error) {
                                    this.logger.error("Error al convertir embedding: ".concat(error.message));
                                    throw new Error('Formato de embedding inválido');
                                }
                            }
                            vectorString = "[".concat(embedding.join(','), "]");
                            return [4 /*yield*/, this.pool.query("SET ivfflat.probes = ".concat(this.probes))];
                        case 2:
                            _a.sent();
                            return [4 /*yield*/, this.pool.query("SELECT \n         id::TEXT,\n         text AS description,\n         1 - (embedding <=> $1::vector) AS similarity\n       FROM \n         ".concat(this.productTable, "\n       ORDER BY \n         embedding <=> $1::vector\n       LIMIT $2"), [vectorString, limit])];
                        case 3:
                            result = _a.sent();
                            this.logger.log("Productos similares encontrados: ".concat(result.rows.length));
                            if (result.rows.length === 0) {
                                return [2 /*return*/, {
                                        codigo: null,
                                        text: null,
                                        similitud: "DISTINTO"
                                    }];
                            }
                            return [4 /*yield*/, this.selectBestProductWithGPT(originalQueryOverride || inputText, result.rows, inputText)];
                        case 4:
                            best = _a.sent();
                            return [2 /*return*/, best];
                    }
                });
            });
        };
        SearchService_1.prototype.selectBestProductWithGPT = function (originalQuery, products, normalizedQuery) {
            return __awaiter(this, void 0, void 0, function () {
                var productsForGPT, prompt_1, gptResponse, gptContent, gptDecision, selectedProduct, error_2, firstProduct, cleanText, productCode, parsed;
                var _a, _b;
                return __generator(this, function (_c) {
                    switch (_c.label) {
                        case 0:
                            _c.trys.push([0, 2, , 3]);
                            this.logger.log("Seleccionando mejor producto con GPT para: \"".concat(originalQuery, "\""));
                            productsForGPT = products.map(function (product, index) {
                                var _a;
                                var cleanText = '';
                                var productCode = '';
                                try {
                                    var parsed = JSON.parse(product.description);
                                    cleanText = parsed.text || '';
                                    if (((_a = parsed.metadata) === null || _a === void 0 ? void 0 : _a.codigo) && parsed.metadata.codigo.length < 20) {
                                        productCode = parsed.metadata.codigo;
                                    }
                                    else if (parsed.id && parsed.id.length < 20) {
                                        productCode = parsed.id;
                                    }
                                }
                                catch (_b) {
                                    cleanText = product.description || '';
                                }
                                if (!productCode && product.id && product.id.length < 20) {
                                    productCode = product.id;
                                }
                                return {
                                    index: index + 1,
                                    codigo: productCode,
                                    text: cleanText,
                                    vectorSimilarity: product.similarity
                                };
                            });
                            prompt_1 = "Eres un experto en productos y debes seleccionar el mejor producto que coincida con la b\u00FAsqueda del usuario.\n\nQUERY ORIGINAL: \"".concat(originalQuery, "\"\n\nPRODUCTOS CANDIDATOS:\n").concat(productsForGPT.map(function (p) { return "".concat(p.index, ". CODIGO: ").concat(p.codigo, " | TEXTO: \"").concat(p.text, "\" | Similitud vectorial: ").concat(p.vectorSimilarity); }).join('\n'), "\n\nESCALA DE SIMILITUD:\n- EXACTO: Es exactamente el producto buscado\n- EQUIVALENTE: Cumple la misma funci\u00F3n, mismas especificaciones\n- COMPATIBLE: Funciona para el mismo prop\u00F3sito, especificaciones similares\n- ALTERNATIVO: Puede servir pero con diferencias notables\n- DISTINTO: No es lo que se busca\n\nINSTRUCCIONES:\n1. Analiza cada producto considerando marca, modelo, tama\u00F1o, caracter\u00EDsticas t\u00E9cnicas\n2. Selecciona SOLO UNO que sea el mejor match para el query original\n3. Asigna un nivel de similitud seg\u00FAn la escala\n4. Responde SOLO con un JSON v\u00E1lido en este formato exacto:\n\n{\n  \"selectedIndex\": [n\u00FAmero del producto seleccionado 1-5],\n  \"similitud\": \"[EXACTO|EQUIVALENTE|COMPATIBLE|ALTERNATIVO|DISTINTO]\",\n  \"razon\": \"[explicaci\u00F3n breve de por qu\u00E9 es el mejor match]\"\n}");
                            return [4 /*yield*/, this.openai.chat.completions.create({
                                    model: "gpt-4o-mini",
                                    messages: [
                                        {
                                            role: "system",
                                            content: "Eres un experto en análisis de productos. Respondes solo con JSON válido."
                                        },
                                        {
                                            role: "user",
                                            content: prompt_1
                                        }
                                    ],
                                    temperature: 0.1,
                                    max_tokens: 300
                                })];
                        case 1:
                            gptResponse = _c.sent();
                            gptContent = (_a = gptResponse.choices[0].message.content) === null || _a === void 0 ? void 0 : _a.trim();
                            this.logger.log("GPT response: ".concat(gptContent));
                            if (!gptContent) {
                                this.logger.error('GPT response content is null or empty');
                                throw new Error('GPT no devolvió contenido válido');
                            }
                            gptDecision = void 0;
                            try {
                                gptDecision = JSON.parse(gptContent);
                            }
                            catch (error) {
                                this.logger.error("Error parsing GPT response: ".concat(error.message));
                                gptDecision = {
                                    selectedIndex: 1,
                                    similitud: "ALTERNATIVO",
                                    razon: "Error en análisis GPT, seleccionado por similitud vectorial"
                                };
                            }
                            selectedProduct = productsForGPT[gptDecision.selectedIndex - 1];
                            if (!selectedProduct) {
                                this.logger.error("\u00CDndice inv\u00E1lido: ".concat(gptDecision.selectedIndex));
                                throw new Error('Índice de producto seleccionado inválido');
                            }
                            return [2 /*return*/, {
                                    codigo: selectedProduct.codigo,
                                    text: selectedProduct.text,
                                    similitud: gptDecision.similitud
                                }];
                        case 2:
                            error_2 = _c.sent();
                            this.logger.error("Error en selecci\u00F3n GPT: ".concat(error_2.message), error_2.stack);
                            firstProduct = products[0];
                            cleanText = '';
                            productCode = '';
                            try {
                                parsed = JSON.parse(firstProduct.description);
                                cleanText = parsed.text || '';
                                productCode = ((_b = parsed.metadata) === null || _b === void 0 ? void 0 : _b.codigo) || parsed.id || '';
                            }
                            catch (_d) {
                                cleanText = firstProduct.description || '';
                                productCode = firstProduct.id || '';
                            }
                            return [2 /*return*/, {
                                    codigo: productCode,
                                    text: cleanText,
                                    similitud: "ALTERNATIVO"
                                }];
                        case 3: return [2 /*return*/];
                    }
                });
            });
        };
        SearchService_1.prototype.normalizeQueryWithWebSearch = function (query) {
            return __awaiter(this, void 0, void 0, function () {
                var response, normalized, error_3;
                var _a;
                return __generator(this, function (_b) {
                    switch (_b.label) {
                        case 0:
                            _b.trys.push([0, 2, , 3]);
                            this.logger.log("Normalizando query con b\u00FAsqueda web real: \"".concat(query, "\""));
                            return [4 /*yield*/, this.openai.responses.create({
                                    model: "gpt-4o",
                                    tools: [{ type: "web_search_preview" }],
                                    input: "Tu tarea es buscar en internet el producto mencionado y devolver \u00FAnicamente el nombre t\u00E9cnico m\u00E1s preciso basado en la informaci\u00F3n encontrada. No expliques nada. Incluye marca, tipo, color, y presentaci\u00F3n si est\u00E1n disponibles. Usa siempre min\u00FAsculas y sin comillas.\n\nEjemplos:\n\"pintura blanca 5 gal sherwin\" => pintura blanca sherwin 5 galones\n\"guantes de corte nivel 5 m\" => guantes corte nivel 5 talla m\n\"silicona teka transparente 280ml\" => silicona neutra transparente teka 280ml\n\nProducto a normalizar: ".concat(query),
                                })];
                        case 1:
                            response = _b.sent();
                            normalized = (_a = response.output_text) === null || _a === void 0 ? void 0 : _a.trim().replace(/^["']|["']$/g, '');
                            this.logger.log("Query normalizada: \"".concat(normalized, "\""));
                            return [2 /*return*/, normalized || query];
                        case 2:
                            error_3 = _b.sent();
                            this.logger.error("Error en normalizaci\u00F3n con b\u00FAsqueda web: ".concat(error_3.message));
                            return [2 /*return*/, query];
                        case 3: return [2 /*return*/];
                    }
                });
            });
        };
        return SearchService_1;
    }());
    __setFunctionName(_classThis, "SearchService");
    (function () {
        var _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(null) : void 0;
        __esDecorate(null, _classDescriptor = { value: _classThis }, _classDecorators, { kind: "class", name: _classThis.name, metadata: _metadata }, null, _classExtraInitializers);
        SearchService = _classThis = _classDescriptor.value;
        if (_metadata) Object.defineProperty(_classThis, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        __runInitializers(_classThis, _classExtraInitializers);
    })();
    return SearchService = _classThis;
}();
exports.SearchService = SearchService;
