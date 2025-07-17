import { IsString, IsNotEmpty, IsNumber, IsOptional, IsArray, ValidateNested, IsIn } from 'class-validator';
import { Type } from 'class-transformer';

export class DimensionItemDto {
  @IsString()
  @IsNotEmpty()
  cod_articulo: string;

  @IsString()
  @IsNotEmpty()
  unico_articulo: string;

  @IsString()
  @IsNotEmpty()
  descripcion: string;

  @IsString()
  @IsIn(['PZA', 'UND', 'JGO', 'KG', 'MT', 'LT'])
  unidad: string;

  @IsNumber()
  cantidad: number;
}

export class DimensionsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DimensionItemDto)
  items: DimensionItemDto[];
}