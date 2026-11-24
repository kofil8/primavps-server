import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request, Response as ExpressResponse } from 'express';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface Response<T> {
  success: boolean;
  statusCode: number;
  message: string;
  data: T;
}

@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<
  T,
  Response<T>
> {
  intercept(
    context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<Response<T>> {
    const ctx = context.switchToHttp();
    const response = ctx.getResponse<ExpressResponse>();
    const request = ctx.getRequest<Request>();

    const statusCode = response.statusCode;
    const method = request.method;

    return next.handle().pipe(
      map((result) => {
        let defaultMessage = 'Operation successful';
        if (method === 'POST') defaultMessage = 'Resource created successfully';
        if (method === 'GET') defaultMessage = 'Data fetched successfully';
        if (method === 'PATCH' || method === 'PUT')
          defaultMessage = 'Resource updated successfully';
        if (method === 'DELETE')
          defaultMessage = 'Resource deleted successfully';

        if (
          result &&
          typeof result === 'object' &&
          'message' in result &&
          'data' in result
        ) {
          const wrapped = result as unknown as { message: string; data: T };
          return {
            success: true,
            statusCode: statusCode,
            message: wrapped.message,
            data: wrapped.data,
          };
        }

        return {
          success: true,
          statusCode: statusCode,
          message: defaultMessage,
          data: result,
        };
      }),
    );
  }
}
