-- Add SMT as an assignable user role.
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'SMT';
