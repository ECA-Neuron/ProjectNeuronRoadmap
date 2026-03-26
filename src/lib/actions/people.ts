"use server";

import { requireRole } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { personSchema } from "@/lib/validations";
import { revalidatePath } from "next/cache";

export async function getPeople() {
  return prisma.person.findMany({
    orderBy: { name: "asc" },
    include: {
      assignments: { include: { initiative: { include: { workstream: true } } } },
    },
  });
}

export async function createPerson(data: unknown) {
  await requireRole(["ADMIN", "MEMBER"]);
  const parsed = personSchema.parse(data);
  const person = await prisma.person.create({ data: parsed });
  revalidatePath("/people");
  revalidatePath("/workstreams");
  return person;
}

export async function updatePerson(id: string, data: unknown) {
  await requireRole(["ADMIN", "MEMBER"]);
  const parsed = personSchema.parse(data);
  const person = await prisma.person.update({ where: { id }, data: parsed });
  revalidatePath("/people");
  revalidatePath("/workstreams");
  return person;
}

export async function deletePerson(id: string) {
  await requireRole(["ADMIN", "MEMBER"]);
  await prisma.person.delete({ where: { id } });
  revalidatePath("/people");
  revalidatePath("/workstreams");
}

