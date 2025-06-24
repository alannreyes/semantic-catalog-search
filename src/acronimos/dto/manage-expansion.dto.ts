import { IsString, IsBoolean, IsOptional, IsArray } from 'class-validator';

export class RevertExpansionDto {
  @IsString()
  codigo: string;

  @IsBoolean()
  @IsOptional()
  bloquearFuturas?: boolean = true;
}

export class BulkRevertExpansionDto {
  @IsArray()
  @IsString({ each: true })
  codigos: string[];

  @IsBoolean()
  @IsOptional()
  bloquearFuturas?: boolean = true;
}

export class FindExpandedProductsDto {
  @IsString()
  @IsOptional()
  filtro?: string;

  @IsBoolean()
  @IsOptional()
  soloBloqueados?: boolean = false;
}