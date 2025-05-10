import { Router } from 'express';
import { PrescriptionController } from '../controllers';

const prescriptionRoutes = Router();

prescriptionRoutes.post('/verify', PrescriptionController.verifyPrescription);

export default prescriptionRoutes;
