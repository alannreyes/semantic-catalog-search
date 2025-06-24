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
exports.SearchService = void 0;
var common_1 = require("@nestjs/common");
var pg_1 = require("pg");
var SearchService = function () {
    var _classDecorators = [(0, common_1.Injectable)()];
    var _classDescriptor;
    var _classExtraInitializers = [];
    var _classThis;
    var SearchService = _classThis = /** @class */ (function () {
        function SearchService_1(configService) {
            this.configService = configService;
            // Usar directamente DATABASE_URL en lugar de variables individuales
            var databaseUrl = this.configService.get('DATABASE_URL');
            this.pool = new pg_1.Pool({
                connectionString: databaseUrl
            });
        }
        // Extraer código interno de metadata o texto
        SearchService_1.prototype.extractCodigoInterno = function (product) {
            // Primero intentar extraer de metadata.codigo si existe
            if (product.metadata && product.metadata.codigo) {
                return product.metadata.codigo;
            }
            // Si no está en metadata, intentar extraerlo del texto
            if (product.text) {
                // Buscar patrones de código como TP998638 o 04010967
                var tpMatch = product.text.match(/(?:TP|tp|Tp)([0-9]+)/i);
                var numericMatch = product.text.match(/(?<!\w)0\d{6,7}(?!\w)/); // Coincide con números que empiezan con 0 y tienen 7-8 dígitos
                if (tpMatch && tpMatch[0]) {
                    return tpMatch[0];
                }
                else if (numericMatch && numericMatch[0]) {
                    return numericMatch[0];
                }
            }
            // Si no se encuentra en texto, verificar si hay un "id" en metadata que podría ser el código
            if (product.metadata && product.metadata.id) {
                return product.metadata.id;
            }
            return '[empty]'; // Valor por defecto si no se encuentra el código
        };
        SearchService_1.prototype.searchProducts = function (query_1) {
            return __awaiter(this, arguments, void 0, function (query, limit) {
                var searchQuery, result, formattedResults, error_1;
                var _this = this;
                if (limit === void 0) { limit = 5; }
                return __generator(this, function (_a) {
                    switch (_a.label) {
                        case 0:
                            _a.trys.push([0, 2, , 3]);
                            searchQuery = "\n        SELECT \n          id,\n          text,\n          metadata,\n          similarity(text, $1) AS similarity_score\n        FROM \n          productos\n        WHERE \n          text % $1\n        ORDER BY \n          similarity(text, $1) DESC\n        LIMIT $2;\n      ";
                            return [4 /*yield*/, this.pool.query(searchQuery, [query, limit])];
                        case 1:
                            result = _a.sent();
                            formattedResults = result.rows.map(function (product) {
                                var similarityPercentage = Math.round(product.similarity_score * 100);
                                // Extraer el código interno
                                var codigoInterno = _this.extractCodigoInterno(product);
                                return {
                                    id: product.id,
                                    articulo_buscado: query,
                                    articulo_encontrado: product.text,
                                    codigo_interno: codigoInterno,
                                    distancia_coseno: "".concat(similarityPercentage, "%"),
                                    metadata: product.metadata
                                };
                            });
                            return [2 /*return*/, formattedResults];
                        case 2:
                            error_1 = _a.sent();
                            console.error('Error en searchProducts:', error_1.message);
                            throw new Error("Error performing semantic search: ".concat(error_1.message));
                        case 3: return [2 /*return*/];
                    }
                });
            });
        };
        // Método que usa pgvector para búsqueda vectorial con distancia de coseno
        SearchService_1.prototype.searchProductsWithVector = function (query_1) {
            return __awaiter(this, arguments, void 0, function (query, limit) {
                var searchQuery, result, formattedResults, error_2;
                var _this = this;
                if (limit === void 0) { limit = 5; }
                return __generator(this, function (_a) {
                    switch (_a.label) {
                        case 0:
                            _a.trys.push([0, 2, , 3]);
                            searchQuery = "\n        WITH query_embedding AS (\n          SELECT openai_embedding($1) AS embedding\n        )\n        SELECT \n          id,\n          text,\n          metadata,\n          1 - (embedding <=> q.embedding) AS cosine_similarity,\n          embedding <=> q.embedding AS cosine_distance\n        FROM \n          productos p, \n          query_embedding q\n        ORDER BY \n          cosine_distance ASC\n        LIMIT $2;\n      ";
                            return [4 /*yield*/, this.pool.query(searchQuery, [query, limit])];
                        case 1:
                            result = _a.sent();
                            formattedResults = result.rows.map(function (product) {
                                // Convertir la distancia coseno a un porcentaje de similitud (0-100%)
                                var similarityPercentage = Math.round(product.cosine_similarity * 100);
                                // Extraer el código interno
                                var codigoInterno = _this.extractCodigoInterno(product);
                                return {
                                    id: product.id,
                                    articulo_buscado: query,
                                    articulo_encontrado: product.text,
                                    codigo_interno: codigoInterno,
                                    distancia_coseno: "".concat(similarityPercentage, "%"),
                                    metadata: product.metadata
                                };
                            });
                            return [2 /*return*/, formattedResults];
                        case 2:
                            error_2 = _a.sent();
                            console.error('Error en searchProductsWithVector:', error_2.message);
                            throw new Error("Error performing vector search: ".concat(error_2.message));
                        case 3: return [2 /*return*/];
                    }
                });
            });
        };
        // Método seguro que intenta diferentes métodos de búsqueda
        SearchService_1.prototype.safeSearch = function (query_1) {
            return __awaiter(this, arguments, void 0, function (query, limit) {
                var error_3, secondError_1;
                if (limit === void 0) { limit = 5; }
                return __generator(this, function (_a) {
                    switch (_a.label) {
                        case 0:
                            _a.trys.push([0, 2, , 7]);
                            return [4 /*yield*/, this.searchProductsWithVector(query, limit)];
                        case 1: 
                        // Primero intenta con búsqueda vectorial para mejores resultados semánticos
                        return [2 /*return*/, _a.sent()];
                        case 2:
                            error_3 = _a.sent();
                            console.log('Vector search failed, trying trigram search:', error_3.message);
                            _a.label = 3;
                        case 3:
                            _a.trys.push([3, 5, , 6]);
                            return [4 /*yield*/, this.searchProducts(query, limit)];
                        case 4: 
                        // Si falla, intenta con búsqueda de trigram
                        return [2 /*return*/, _a.sent()];
                        case 5:
                            secondError_1 = _a.sent();
                            console.error('All search methods failed:', secondError_1.message);
                            throw new Error("Error performing semantic search: ".concat(secondError_1.message));
                        case 6: return [3 /*break*/, 7];
                        case 7: return [2 /*return*/];
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
