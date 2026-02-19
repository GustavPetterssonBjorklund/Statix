/*
  Warnings:

  - A unique constraint covering the columns `[authTokenHash]` on the table `Node` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Node" ADD COLUMN     "authTokenHash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Node_authTokenHash_key" ON "Node"("authTokenHash");
