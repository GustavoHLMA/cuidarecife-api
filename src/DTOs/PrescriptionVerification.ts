import { z } from 'zod';

const MedicationVerificationSchema = z.object({
  name: z.string({ required_error: 'O nome do medicamento é obrigatório.' }),
  instructions: z.string({ required_error: 'As instruções do medicamento são obrigatórias.' }),
});

export const PrescriptionVerificationRequestSchema = z.object({
  patientName: z.string().optional(),
  returnInDays: z.number().optional(),
  medications: z.array(MedicationVerificationSchema).min(1, { message: 'Pelo menos um medicamento deve ser fornecido.' }),
});

export type PrescriptionVerificationRequest = z.infer<typeof PrescriptionVerificationRequestSchema>;
