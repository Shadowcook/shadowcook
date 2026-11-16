import type { FastifyInstance, FastifyError, FastifyReply, FastifyRequest } from 'fastify';

export function registerErrorHandling(api: FastifyInstance): void {
  api.addHook('onSend', async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    reply.header('X-Request-ID', request.id);
    if (reply.statusCode >= 400) reply.header('Cache-Control', 'no-store');
    else if (!reply.hasHeader('Cache-Control')) reply.header('Cache-Control', 'private, no-store');
  });
  api.setErrorHandler((error: FastifyError, request: FastifyRequest, reply: FastifyReply): void => {
    const status: number =
      error.statusCode !== undefined && error.statusCode >= 400 && error.statusCode <= 599
        ? error.statusCode
        : 500;
    if (status >= 500) {
      request.log.error(
        { requestId: request.id, errorCode: error.code, errorName: error.name },
        'Unhandled server error',
      );
    }
    const code: string =
      status >= 500
        ? 'INTERNAL_SERVER_ERROR'
        : error.validation !== undefined
          ? 'VALIDATION_ERROR'
          : /^FST_[A-Z0-9_]+$/.test(error.code ?? '')
            ? error.code
            : 'REQUEST_FAILED';
    const message: string =
      status >= 500 ? 'Internal Server Error' : 'The request could not be processed';
    reply.code(status).send({ statusCode: status, code, error: message, message });
  });
}
