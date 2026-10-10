/*
  Warnings:

  - Made the column `apellido` on table `enfermeros` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "enfermeros" ALTER COLUMN "apellido" SET NOT NULL;
