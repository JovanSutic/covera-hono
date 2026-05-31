import type { User } from "@/db";

const users: User[] = [
  {
    id: "usr_1",
    name: "dde",
    email: "admin@example.com",
    roles: ["admin"],
    createdAt: new Date(),
  },

  {
    id: "usr_2",
    name: "dde",
    email: "host@example.com",
    roles: ["host"],
    createdAt: new Date(),
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
