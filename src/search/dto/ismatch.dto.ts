import { IsString, IsNotEmpty } from 'class-validator';

export class IsMatchDto {
  @IsString()
  @IsNotEmpty()
  producto1: string;

  @IsString()
  @IsNotEmpty()
  producto2: string;
}