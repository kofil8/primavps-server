import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtPayload } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AdjustWalletDto } from './dto/adjust-wallet.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { FindUsersQueryDto } from './dto/find-users-query.dto';
import { UpdateProfileDto, UpdateUserDto } from './dto/update-user.dto';
import { UserExistsPipe } from './pipes/user-exist.pipe';
import { UserService } from './user.service';

@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get('me')
  getMyProfile(@CurrentUser() currentUser: JwtPayload) {
    return this.userService.findUserById(currentUser.sub, currentUser);
  }

  @Patch('me')
  updateMyProfile(
    @CurrentUser('sub') userId: string,
    @Body() updateProfileDto: UpdateProfileDto,
  ) {
    return this.userService.updateProfile(userId, updateProfileDto);
  }

  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @Post()
  createUser(
    @Body() createUserDto: CreateUserDto,
    @CurrentUser() currentUser: JwtPayload,
  ) {
    return this.userService.createUser(createUserDto, currentUser);
  }

  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.SUPPORT)
  @Get()
  findAllUsers(@Query() query: FindUsersQueryDto) {
    return this.userService.findAllUsers(query);
  }

  @Get(':id')
  findUserById(
    @Param('id', UserExistsPipe) id: string,
    @CurrentUser() currentUser: JwtPayload,
  ) {
    return this.userService.findUserById(id, currentUser);
  }

  @Patch(':id')
  updateUserById(
    @Param('id', UserExistsPipe) id: string,
    @Body() updateUserDto: UpdateUserDto,
    @CurrentUser() currentUser: JwtPayload,
  ) {
    return this.userService.updateUserById(id, updateUserDto, currentUser);
  }

  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @Post(':id/wallet-adjust')
  @HttpCode(HttpStatus.OK)
  adjustWallet(
    @Param('id', UserExistsPipe) id: string,
    @Body() adjustWalletDto: AdjustWalletDto,
    @CurrentUser() currentUser: JwtPayload,
  ) {
    return this.userService.adjustWallet(id, adjustWalletDto, currentUser);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteUserById(
    @Param('id', UserExistsPipe) id: string,
    @CurrentUser() currentUser: JwtPayload,
  ) {
    await this.userService.deleteUserById(id, currentUser);
  }
}
