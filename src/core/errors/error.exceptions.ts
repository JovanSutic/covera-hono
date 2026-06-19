import { ContentfulStatusCode } from "hono/utils/http-status";

export class CustomException extends Error {
  constructor(
    public status: ContentfulStatusCode,
    public code: string,
    message: string
  ) {
    super(message);
    this.name = "CustomException";
  }
}

export class NotFoundException extends CustomException {
  constructor(resource: string) {
    super(404, "NOT_FOUND", `Not Found: The requested ${resource} could not be found.`);
  }
}

export class ConflictException extends CustomException {
  constructor(resource: string) {
    super(409, "CONFLICT", `Conflict: This ${resource} already exists or conflicts with existing data.`);
  }
}

export class BadRequestException extends CustomException {
  constructor(message: string, code = "BAD_REQUEST") {
    super(400, code, message);
  }
}

export class UnauthorizedException extends CustomException {
  constructor(message = "Unauthorized: Missing or invalid token.") {
    super(401, "UNAUTHORIZED", message);
  }
}
