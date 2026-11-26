import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsStrongPassword,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Role } from '@prisma/client';

export class CreateUserDto {
  @IsEmail({}, { message: 'Please provide a valid email address' })
  @IsNotEmpty({ message: 'Email is required' })
  email!: string;

  @IsNotEmpty({ message: 'firstName is required' })
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  firstName!: string;

  @IsNotEmpty({ message: 'lastName is required' })
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  lastName!: string;

  @IsNotEmpty({ message: 'Password is required' })
  @IsString()
  @IsStrongPassword()
  password!: string;

  @IsOptional()
  @IsString()
  @Matches(/^[+]?[0-9\s-]{8,20}$/, {
    message: 'phone must be a valid phone number',
  })
  phone?: string;

  @IsOptional()
  @IsEnum(Role)
  role?: Role = Role.USER;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(50)
  resellerDiscount?: number;

  @IsOptional()
  @IsBoolean()
  emailVerified?: boolean;
}
