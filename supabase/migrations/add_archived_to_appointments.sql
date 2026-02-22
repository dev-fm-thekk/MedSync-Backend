-- Add archived column to appointments for archiving finished appointments
ALTER TABLE public.appointments
ADD COLUMN IF NOT EXISTS archived boolean DEFAULT false;
