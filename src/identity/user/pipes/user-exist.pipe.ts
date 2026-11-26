import {
  ArgumentMetadata,
  Injectable,
  BadRequestException,
  NotFoundException,
  PipeTransform,
} from '@nestjs/common';
import { validate as isUUID } from 'uuid';
import { UserService } from '../user.service';

@Injectable()
export class UserExistsPipe implements PipeTransform {
  constructor(private readonly userService: UserService) {}

  async transform(value: string, metadata: ArgumentMetadata): Promise<string> {
    if (!isUUID(value)) {
      throw new BadRequestException(
        `Invalid UUID format for parameter '${metadata.data || 'id'}'`,
      );
    }

    const exists = await this.userService.existsActiveUser(value);

    if (!exists) {
      throw new NotFoundException(`User with ID ${value} not found.`);
    }

    return value;
  }
}
