import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class AnalyzeImageDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200, { message: 'Filename must not exceed 200 characters' })
  filename?: string;
}