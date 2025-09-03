import { IsString, IsNotEmpty, IsOptional, IsIn, IsInt, Min, Max, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';

export class SearchV2Dto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500, { message: 'Query must not exceed 500 characters' })
  query: string;

  @IsOptional()
  @IsInt()
  @Min(1, { message: 'Limit must be at least 1' })
  @Max(50, { message: 'Limit must not exceed 50' })
  @Transform(({ value }) => parseInt(value))
  limit?: number = 5;

  @IsOptional()
  @IsIn(['premium', 'standard', 'economy'], {
    message: 'Segment must be one of: premium, standard, economy'
  })
  segment?: 'premium' | 'standard' | 'economy';

  @IsOptional()
  @IsString()
  @MaxLength(100, { message: 'Cliente must not exceed 100 characters' })
  cliente?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100, { message: 'Marca must not exceed 100 characters' })
  marca?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100, { message: 'Codigo_fabrica must not exceed 100 characters' })
  codigo_fabrica?: string;
}