const router = require('express').Router();
const { authMiddleware, requireRole } = require('../middleware/auth');
const { internalError } = require('../utils/errors');
const whatsappService = require('../services/whatsapp');

router.use(authMiddleware, requireRole('admin'));

// GET /api/whatsapp/status — estado da conexão da instância (open/close/connecting)
router.get('/status', async (req, res) => {
  try {
    const state = await whatsappService.connectionState();
    res.json({ state });
  } catch (err) {
    internalError(res, err, '[whatsapp/status]');
  }
});

// POST /api/whatsapp/connect — gera um novo QR Code pra parear a instância
router.post('/connect', async (req, res) => {
  try {
    const { code, base64 } = await whatsappService.requestQrCode();
    if (!base64 && !code) return res.status(502).json({ error: 'Evolution API não respondeu — verifique se o serviço está no ar' });
    res.json({ code, base64 });
  } catch (err) {
    internalError(res, err, '[whatsapp/connect]');
  }
});

// POST /api/whatsapp/logout — encerra a sessão pareada (precisa escanear QR de novo depois)
router.post('/logout', async (req, res) => {
  try {
    await whatsappService.logoutInstance();
    res.json({ ok: true });
  } catch (err) {
    internalError(res, err, '[whatsapp/logout]');
  }
});

// GET /api/whatsapp/templates — mensagens automáticas por status do pedido
router.get('/templates', async (req, res) => {
  try {
    const templates = await whatsappService.getTemplates();
    res.json({ templates });
  } catch (err) {
    internalError(res, err, '[whatsapp/templates/GET]');
  }
});

// PUT /api/whatsapp/templates — salva texto/ligado por status
router.put('/templates', async (req, res) => {
  try {
    const { templates } = req.body;
    if (!templates || typeof templates !== 'object') return res.status(400).json({ error: 'templates é obrigatório' });
    await whatsappService.saveTemplates(templates);
    res.json({ templates: await whatsappService.getTemplates() });
  } catch (err) {
    internalError(res, err, '[whatsapp/templates/PUT]');
  }
});

// GET /api/whatsapp/audience?filter=all|30d|60d_inactive — quantos clientes recebem
router.get('/audience', async (req, res) => {
  const filter = req.query.filter || 'all';
  try {
    const recipients = await whatsappService.audienceList(filter);
    res.json({ filter, count: recipients.length });
  } catch (err) {
    if (err?.status === 400) return res.status(400).json({ error: err.message });
    internalError(res, err, '[whatsapp/audience]');
  }
});

// POST /api/whatsapp/campaigns — dispara campanha em massa (fila espaçada em background)
router.post('/campaigns', async (req, res) => {
  const { name, message, filter } = req.body;
  if (!name?.trim() || !message?.trim() || !filter) {
    return res.status(400).json({ error: 'name, message e filter são obrigatórios' });
  }
  try {
    const campaign = await whatsappService.startCampaign({ name: name.trim(), message: message.trim(), filter, createdBy: req.user?.id });
    res.status(201).json(campaign);
  } catch (err) {
    if (err?.status === 400) return res.status(400).json({ error: err.message });
    internalError(res, err, '[whatsapp/campaigns/POST]');
  }
});

// GET /api/whatsapp/campaigns — histórico (mais recentes primeiro)
router.get('/campaigns', async (req, res) => {
  try {
    const campaigns = await whatsappService.listCampaigns();
    res.json(campaigns);
  } catch (err) {
    internalError(res, err, '[whatsapp/campaigns/GET]');
  }
});

module.exports = router;
