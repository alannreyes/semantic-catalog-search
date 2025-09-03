import { IsString, IsOptional, IsNumber, Min, Max } from 'class-validator';

export class SearchV2Dto {
  @IsString()
  query: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(50)
  limit?: number;

  @IsOptional()
  @IsString()
  segment?: 'premium' | 'standard' | 'economy';

  @IsOptional()
  @IsString()
  cliente?: string;

  @IsOptional()
  @IsString()
  marca?: string;
}