import { z } from 'zod';

const MedicationVerificationSchema = z.object({
  name: z.string({ required_error: 'O nome do medicamento é obrigatório.' }),
  instructions: z.string().optional().default('Conforme orientação médica'),
});

export const PrescriptionVerificationRequestSchema = z.object({
  patientName: z.string().optional().nullable(),
  returnInDays: z.number().optional().nullable(),
  medications: z.array(MedicationVerificationSchema).min(1, { message: 'Pelo menos um medicamento deve ser fornecido.' }),
});

export type PrescriptionVerificationRequest = z.infer<typeof PrescriptionVerificationRequestSchema>;

