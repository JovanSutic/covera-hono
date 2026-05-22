import type { User } from "./users.types";

const users: User[] = [
  {
    id: "usr_1",
    email: "admin@example.com",
    roles: ["admin"],
  },

  {
    id: "usr_2",
    email: "host@example.com",
    roles: ["host"],
  },
];

export const usersService = {
  getAll(): User[] {
    return users;
  },

  getById(id: string): User | undefined {
    return users.find((user) => user.id === id);
  },
};
