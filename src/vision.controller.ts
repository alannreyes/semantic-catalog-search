import {
  Controller,
  Post,
  UseInterceptors,
  UploadedFile,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { VisionService } from './vision.service';
import { Express } from 'express';
import { memoryStorage } from 'multer';

@Controller('vision')
export class VisionController {
  private readonly logger = new Logger(VisionController.name);

  constructor(private readonly visionService: VisionService) {}

  @Post('analyze')
  @UseInterceptors(
    FileInterceptor('image', {
      storage: memoryStorage(),
      limits: {
        fileSize: 10 * 1024 * 1024, // 10MB máximo
      },
      fileFilter: (req, file, callback) => {
        if (!file.mimetype.match(/\/(jpg|jpeg|png|gif|webp)$/)) {
          return callback(
            new HttpException(
              'Solo se permiten imágenes (jpg, jpeg, png, gif, webp)',
              HttpStatus.BAD_REQUEST
            ),
            false
          );
        }
        callback(null, true);
      },
    })
  )
  async analyzeImage(@UploadedFile() file: Express.Multer.File) {
    try {
      if (!file) {
        throw new HttpException('No se proporcionó imagen', HttpStatus.BAD_REQUEST);
      }

      this.logger.log(`Recibida imagen para análisis: ${file.originalname} (${file.size} bytes)`);

      const result = await this.visionService.analyzeProductImage(
        file.buffer,
        file.mimetype
      );

      if (result.confidence < 0.5) {
        this.logger.warn(`Baja confianza en identificación: ${result.confidence}`);
      }

      return result;
    } catch (error) {
      this.logger.error(`Error en análisis de imagen: ${error.message}`);
      
      if (error instanceof HttpException) {
        throw error;
      }
      
      throw new HttpException(
        'Error al procesar la imagen',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
}
