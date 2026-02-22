import { Router, Request, Response } from 'express';
import supabase from '../../supabase/client.js';

const router = Router();

type UserRole = 'patient' | 'doctor';

function parseDate(dateStr: string): Date {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) throw new Error('Invalid date');
  return d;
}

router.get('/v1/profiles/:id', async (req: Request, res: Response): Promise<void> => {
  const id = req.params.id as string;
  if (!id || id.length < 10) {
    res.status(400).json({ error: 'Invalid profile id' });
    return;
  }

  const { data, error } = await supabase.from('profiles').select('*').eq('id', id).single();

  if (error && error.code !== 'PGRST116') {
    res.status(500).json({ error: error.message });
    return;
  }

  if (data) {
    res.status(200).json(data);
    return;
  }

  const { data: created, error: insertError } = await supabase
    .from('profiles')
    .insert({ id, role: 'patient' as UserRole })
    .select()
    .single();

  if (insertError) {
    res.status(500).json({ error: insertError.message });
    return;
  }

  res.status(201).json(created);
});

router.put('/v1/profiles/:id', async (req: Request, res: Response): Promise<void> => {
  const id = req.params.id as string;
  const { role, full_name } = req.body as { role?: UserRole; full_name?: string };

  if (!id) {
    res.status(400).json({ error: 'Invalid profile id' });
    return;
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (role) updates.role = role;
  if (full_name !== undefined) updates.full_name = full_name;

  const { data, error } = await supabase.from('profiles').update(updates).eq('id', id).select().single();

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.status(200).json(data);
});

router.get('/v1/doctors', async (_req: Request, res: Response): Promise<void> => {
  const { data, error } = await supabase.from('profiles').select('id, full_name, role').eq('role', 'doctor');

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.status(200).json(data ?? []);
});

router.get('/v1/appointments/doctor/:doctorId', async (req: Request, res: Response): Promise<void> => {
  const doctorId = req.params.doctorId as string;
  const dateStr = req.query.date as string | undefined;
  const includeArchived = req.query.archived === 'true';

  if (!doctorId) {
    res.status(400).json({ error: 'Doctor id required' });
    return;
  }

  let query = supabase.from('appointments').select('*').eq('doctor_id', doctorId);

  if (!includeArchived) {
    query = query.or('archived.eq.false,archived.is.null');
  }

  if (dateStr) {
    try {
      const d = parseDate(dateStr);
      const start = new Date(d);
      start.setHours(0, 0, 0, 0);
      const end = new Date(d);
      end.setHours(23, 59, 59, 999);
      query = query.gte('appointment_time', start.toISOString()).lte('appointment_time', end.toISOString());
    } catch {
      res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
      return;
    }
  }

  const { data, error } = await query.order('appointment_time', { ascending: true });

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.status(200).json(data ?? []);
});

router.get('/v1/appointments/patient/:patientId', async (req: Request, res: Response): Promise<void> => {
  const patientId = req.params.patientId as string;
  const includeArchived = req.query.archived === 'true';

  if (!patientId) {
    res.status(400).json({ error: 'Patient id required' });
    return;
  }

  let query = supabase.from('appointments').select('*').eq('patient_id', patientId);

  if (!includeArchived) {
    query = query.or('archived.eq.false,archived.is.null');
  }

  const { data, error } = await query.order('appointment_time', { ascending: false });

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.status(200).json(data ?? []);
});

router.post('/v1/appointments', async (req: Request, res: Response): Promise<void> => {
  const { patient_id, doctor_id, slot_number, appointment_time } = req.body as {
    patient_id?: string;
    doctor_id?: string;
    slot_number?: number;
    appointment_time?: string;
  };

  if (!patient_id || !doctor_id || slot_number === undefined || !appointment_time) {
    res.status(400).json({ error: 'Missing required fields: patient_id, doctor_id, slot_number, appointment_time' });
    return;
  }

  let apptTime: Date;
  try {
    apptTime = parseDate(appointment_time);
  } catch {
    res.status(400).json({ error: 'Invalid appointment_time format (ISO 8601)' });
    return;
  }

  const slot = Number(slot_number);
  if (!Number.isInteger(slot) || slot < 0 || slot > 47) {
    res.status(400).json({ error: 'slot_number must be 0-47 (30-min slots in a day)' });
    return;
  }

  const { data, error } = await supabase
    .from('appointments')
    .insert({
      patient_id,
      doctor_id,
      slot_number: slot,
      appointment_time: apptTime.toISOString(),
    })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') {
      res.status(409).json({ error: 'Slot already booked' });
      return;
    }
    res.status(500).json({ error: error.message });
    return;
  }

  res.status(201).json(data);
});

router.patch('/v1/appointments/:id/archive', async (req: Request, res: Response): Promise<void> => {
  const id = req.params.id as string;
  const { doctor_id } = req.body as { doctor_id?: string };

  if (!id) {
    res.status(400).json({ error: 'Appointment id required' });
    return;
  }

  const { data, error } = await supabase
    .from('appointments')
    .update({ archived: true })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.status(200).json(data);
});

router.get('/v1/slots/:doctorId', async (req: Request, res: Response): Promise<void> => {
  const doctorId = req.params.doctorId as string;
  const dateStr = req.query.date as string | undefined;

  if (!doctorId || !dateStr) {
    res.status(400).json({ error: 'doctorId and date (YYYY-MM-DD) required' });
    return;
  }

  let baseDate: Date;
  try {
    baseDate = parseDate(dateStr);
  } catch {
    res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
    return;
  }

  const start = new Date(baseDate);
  start.setHours(0, 0, 0, 0);
  const end = new Date(baseDate);
  end.setHours(23, 59, 59, 999);

  const { data: booked, error } = await supabase
    .from('appointments')
    .select('slot_number')
    .eq('doctor_id', doctorId)
    .or('archived.eq.false,archived.is.null')
    .gte('appointment_time', start.toISOString())
    .lte('appointment_time', end.toISOString());

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  const bookedSlots = new Set((booked ?? []).map((a) => a.slot_number));
  const available: number[] = [];
  for (let s = 0; s < 48; s++) {
    if (!bookedSlots.has(s)) available.push(s);
  }

  res.status(200).json({ date: dateStr, doctorId, availableSlots: available, bookedSlots: [...bookedSlots] });
});

export default router;
