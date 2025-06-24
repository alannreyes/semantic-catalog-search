import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

@Injectable()
export class VisionService {
  private openai: OpenAI;
  private readonly logger = new Logger(VisionService.name);

  constructor(private configService: ConfigService) {
    this.openai = new OpenAI({
      apiKey: this.configService.get<string>('OPENAI_API_KEY'),
      timeout: 60000, // 60 segundos para imágenes
      maxRetries: 2,
    });
  }

  async analyzeProductImage(imageBuffer: Buffer, mimeType: string): Promise<{ description: string; confidence: number }> {
    const startTime = process.hrtime.bigint();
    
    try {
      this.logger.log('Iniciando análisis de imagen con GPT-4 Vision');

      // Convertir buffer a base64
      const base64Image = imageBuffer.toString('base64');
      const dataUri = `data:${mimeType};base64,${base64Image}`;

      const response = await this.openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: `Eres un experto en identificación de productos industriales, herramientas y equipos. 
            Tu tarea es analizar la imagen y proporcionar ÚNICAMENTE el nombre técnico del producto.
            
            Reglas:
            - Identifica marca, modelo, tipo, tamaño y características visibles
            - Usa terminología técnica estándar de la industria
            - Sé específico pero conciso
            - Si ves texto en la imagen, inclúyelo cuando sea relevante
            - Responde SOLO con el nombre del producto, sin explicaciones adicionales
            
            Ejemplos de respuestas correctas:
            - "martillo carpintero stanley fatmax 20oz"
            - "llave ajustable cromada 10 pulgadas"
            - "taladro percutor bosch 850w azul"
            - "casco seguridad 3m blanco ventilado"
            - "guantes nitrilo negro talla l"
            
            Si no puedes identificar el producto con certeza, responde: "producto no identificado"`
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
      });

      const description = response.choices[0]?.message?.content?.trim().toLowerCase() || '';
      
      // Calcular confianza basada en la respuesta
      const confidence = description.includes('no identificado') ? 0.2 : 0.8;

      const endTime = process.hrtime.bigint();
      const duration = Number(endTime - startTime) / 1_000_000;

      this.logger.log(`Análisis de imagen completado en ${duration}ms. Resultado: "${description}"`);

      return {
        description,
        confidence
      };

    } catch (error) {
      const endTime = process.hrtime.bigint();
      const duration = Number(endTime - startTime) / 1_000_000;
      
      this.logger.error(
        `Error en análisis de imagen después de ${duration}ms: ${error.message}`,
        error.stack
      );
      
      throw new Error(`Error al analizar imagen: ${error.message}`);
    }
  }
}
