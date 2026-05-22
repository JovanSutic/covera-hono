export type UserRole = "admin" | "host" | "guest";

export type User = {
  id: string;
  email: string;
  roles: UserRole[];
};
