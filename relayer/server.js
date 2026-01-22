import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const port = process.env.PORT || 8787;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);
const app = express();

app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.post('/proofs', async (req, res) => {
  try {
    const { wallet, proof, publicSignals, commitment, nonce, chainId } = req.body || {};
    if (!wallet || !proof || !publicSignals) {
      return res.status(400).json({ error: 'Missing proof payload.' });
    }
    const { data, error } = await supabase
      .from('proof_submissions')
      .insert({
        wallet: wallet.toLowerCase(),
        proof,
        public_signals: publicSignals,
        commitment,
        nonce,
        chain_id: chainId ?? null,
      })
      .select()
      .single();
    if (error) {
      return res.status(500).json({ error: error.message });
    }
    return res.json({ id: data.id, created_at: data.created_at });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Relayer failed.' });
  }
});

app.get('/proofs', async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit || 25), 500);
    const offset = Math.max(Number(req.query.offset || 0), 0);
    const wallet = req.query.wallet;
    const from = req.query.from;
    const to = req.query.to;
    let query = supabase
      .from('proof_submissions')
      .select('id,wallet,commitment,nonce,chain_id,created_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);
    if (wallet) {
      query = query.eq('wallet', wallet.toLowerCase());
    }
    if (from) {
      query = query.gte('created_at', from);
    }
    if (to) {
      query = query.lte('created_at', to);
    }
    const { data, error, count } = await query;
    if (error) {
      return res.status(500).json({ error: error.message });
    }
    return res.json({ data, count });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Relayer failed.' });
  }
});

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.listen(port, () => {
  console.log(`Relayer running on http://localhost:${port}`);
});
