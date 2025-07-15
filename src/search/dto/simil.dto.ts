import { IsString, IsNotEmpty } from 'class-validator';

export class SimilDto {
  @IsString()
  @IsNotEmpty()
  texto1: string;

  @IsString()
  @IsNotEmpty()
  texto2: string;
}