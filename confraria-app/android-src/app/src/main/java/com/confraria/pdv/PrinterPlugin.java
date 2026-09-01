package com.confraria.pdv;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.JSArray;

import java.io.ByteArrayOutputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.util.ArrayList;
import java.util.List;

/**
 * Ponte JS -> impressora térmica de rede (Elgin i9) via ESC/POS puro em socket
 * TCP na porta 9100.
 *
 * Por que socket direto e não o AAR da Elgin: para conexão de REDE, o SDK da
 * Elgin (AbreConexaoImpressora com tipo 3) faz exatamente isto — abre um socket
 * no IP:porta e despeja bytes ESC/POS. O ganho do SDK está nas conexões USB e
 * serial, onde ele resolve driver. Aqui, socket direto tira uma dependência
 * binária do build e é o mesmo protocolo que o agente de impressão da Confraria
 * já usa em produção.
 *
 * Imprime UM CUPOM por venda (antes era uma ficha por unidade, que gastava
 * papel demais). Duas vias possíveis, com layouts diferentes:
 *   - balcão: itens com preço, total e forma de pagamento (comprovante do cliente)
 *   - cozinha: só os itens marcados, SEM preço, nome em fonte alta (lê de longe)
 */
@CapacitorPlugin(name = "ConfrariaPrinter")
public class PrinterPlugin extends Plugin {

    private static final int COLS = 48; // 80mm

    // ── ESC/POS ─────────────────────────────────────────
    private static final byte[] INIT = { 0x1B, 0x40 };            // ESC @
    private static final byte[] ALIGN_CENTER = { 0x1B, 0x61, 1 }; // ESC a 1
    private static final byte[] ALIGN_LEFT = { 0x1B, 0x61, 0 };
    private static final byte[] BOLD_ON = { 0x1B, 0x45, 1 };
    private static final byte[] BOLD_OFF = { 0x1B, 0x45, 0 };
    private static final byte[] CODEPAGE_850 = { 0x1B, 0x74, 2 }; // ESC t 2 (PC850)
    private static final byte[] CUT = { 0x1D, 0x56, 66, 0 };      // GS V B 0
    private static final byte[] LF = { 0x0A };

    /** GS ! n — n = (largura-1)<<4 | (altura-1), 1..8 cada. */
    private static byte[] textSize(int w, int h) {
        int n = ((w - 1) << 4) | (h - 1);
        return new byte[] { 0x1D, 0x21, (byte) n };
    }

    private static class Item {
        String name;
        int quantity;
        double total;
    }

    @PluginMethod
    public void printCupom(PluginCall call) {
        String ip = call.getString("ip", "");
        int port = call.getInt("port", 9100);
        String saleNumber = call.getString("saleNumber", "");
        String operator = call.getString("operator", "");
        // Nome no topo do cupom e a linha abaixo dele (era fixo "SEAMA" e
        // "SENHA "+numero, herdados do plugin da Seama -- agora o JS decide os
        // dois, com valor de reserva pra nao imprimir em branco se faltar.
        String header = call.getString("header", "CONFRARIA CAFE");
        String subtitle = call.getString("subtitle", saleNumber);
        Double subtotal = call.getDouble("subtotal");
        String payment = call.getString("payment", "");
        Double totalObj = call.getDouble("total");
        double total = totalObj == null ? 0 : totalObj;
        boolean kitchen = Boolean.TRUE.equals(call.getBoolean("kitchen", false));
        JSArray itemsArr = call.getArray("items");

        if (ip == null || ip.isEmpty()) {
            call.reject("IP da impressora não configurado");
            return;
        }
        if (itemsArr == null || itemsArr.length() == 0) {
            call.reject("Nenhum item para imprimir");
            return;
        }

        List<Item> items = new ArrayList<>();
        try {
            for (int i = 0; i < itemsArr.length(); i++) {
                JSObject o = JSObject.fromJSONObject(itemsArr.getJSONObject(i));
                Item it = new Item();
                it.name = o.getString("name", "");
                Integer q = o.getInteger("quantity");
                it.quantity = q == null ? 1 : q;
                Double t = o.getDouble("total");
                it.total = t == null ? 0 : t;
                items.add(it);
            }
        } catch (Exception e) {
            call.reject("Itens em formato inválido: " + e.getMessage());
            return;
        }

        // Socket na thread principal trava o app.
        new Thread(() -> {
            Socket socket = null;
            try {
                socket = new Socket();
                socket.connect(new InetSocketAddress(ip, port), 5000);
                OutputStream out = socket.getOutputStream();
                out.write(kitchen
                        ? buildCupomCozinha(items, saleNumber, operator)
                        : buildCupomBalcao(items, saleNumber, operator, total, payment, header, subtitle, subtotal));
                out.flush();
                JSObject ret = new JSObject();
                ret.put("printed", 1);
                ret.put("items", items.size());
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("Falha ao imprimir: " + e.getMessage());
            } finally {
                if (socket != null) {
                    try { socket.close(); } catch (Exception ignored) {}
                }
            }
        }).start();
    }

    /** Só testa se a impressora responde, sem gastar papel. */
    @PluginMethod
    public void testConnection(PluginCall call) {
        String ip = call.getString("ip", "");
        int port = call.getInt("port", 9100);
        if (ip == null || ip.isEmpty()) {
            call.reject("IP da impressora não configurado");
            return;
        }
        new Thread(() -> {
            try (Socket s = new Socket()) {
                s.connect(new InetSocketAddress(ip, port), 5000);
                JSObject ret = new JSObject();
                ret.put("ok", true);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("Sem resposta de " + ip + ":" + port + " — " + e.getMessage());
            }
        }).start();
    }

    // ── Cupom do balcão (comprovante do cliente) ────────
    private byte[] buildCupomBalcao(List<Item> items, String saleNumber, String operator,
                                    double total, String payment, String header,
                                    String subtitle, Double subtotal) throws Exception {
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        header(b, header, subtitle);

        b.write(ALIGN_LEFT);
        b.write(line(dateNow() + " " + timeNow()));
        if (operator != null && !operator.isEmpty()) b.write(line("Operador: " + operator));
        b.write(line(rule('-')));
        b.write(line(cols("QTD", "ITEM", "VALOR")));
        b.write(line(rule('-')));

        for (Item it : items) {
            b.write(line(cols(String.valueOf(it.quantity), it.name, money(it.total))));
        }

        if (subtotal != null && subtotal < total - 0.001) {
            b.write(line(pad("Subtotal", "R$ " + money(subtotal), COLS)));
            b.write(line(pad("Taxa de servico", "R$ " + money(total - subtotal), COLS)));
        }
        b.write(line(rule('-')));
        b.write(BOLD_ON);
        b.write(textSize(1, 2));
        b.write(line(pad("TOTAL", "R$ " + money(total), COLS)));
        b.write(textSize(1, 1));
        b.write(BOLD_OFF);
        if (payment != null && !payment.isEmpty()) b.write(line("Pagamento: " + payment));
        b.write(line(rule('-')));

        b.write(ALIGN_CENTER);
        b.write(line("Obrigado pela preferencia!"));
        footer(b);
        return b.toByteArray();
    }

    // ── Via da cozinha (produção) ───────────────────────
    private byte[] buildCupomCozinha(List<Item> items, String saleNumber, String operator) throws Exception {
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        // "SENHA "+numero preservado aqui de propósito: era o comportamento
        // desta via antes da mudança, e continua fazendo sentido — a cozinha
        // casa o pedido pela senha. Só o cupom do cliente parou de usar essa
        // palavra (ver buildCupomBalcao).
        header(b, "COZINHA", "SENHA " + saleNumber);

        b.write(ALIGN_LEFT);
        b.write(line(pad(timeNow(), operator == null ? "" : operator, COLS)));
        b.write(line(rule('-')));
        b.write(LF);

        // Sem preço e em fonte alta: o cozinheiro precisa ler rápido e de longe.
        for (Item it : items) {
            b.write(BOLD_ON);
            b.write(textSize(1, 2));
            b.write(line("  " + it.quantity + "x " + it.name.toUpperCase()));
            b.write(textSize(1, 1));
            b.write(BOLD_OFF);
            b.write(LF);
        }

        b.write(line(rule('-')));
        footer(b);
        return b.toByteArray();
    }

    private void header(ByteArrayOutputStream b, String title, String subtitle) throws Exception {
        b.write(INIT);
        b.write(CODEPAGE_850);
        b.write(ALIGN_CENTER);
        b.write(BOLD_ON);
        b.write(textSize(1, 2));
        b.write(line(title));
        b.write(textSize(1, 1));
        b.write(BOLD_OFF);
        b.write(line(rule('=')));
        // Linha de identificação em destaque, texto completo decidido por quem
        // chama — "SENHA 42" faz sentido pra cozinha achar o pedido, mas
        // "Comanda 05" (sem "SENHA") é o que cabe no cupom de fechar mesa.
        b.write(BOLD_ON);
        b.write(textSize(2, 2));
        b.write(line(subtitle));
        b.write(textSize(1, 1));
        b.write(BOLD_OFF);
        b.write(line(rule('=')));
    }

    private void footer(ByteArrayOutputStream b) throws Exception {
        b.write(LF);
        b.write(LF);
        b.write(LF);
        b.write(ALIGN_LEFT);
        b.write(CUT);
    }

    /** Linha de item: qtd (3) + nome + valor (10 à direita), truncando o nome. */
    private String cols(String qty, String name, String value) {
        String q = padLeft(qty, 3);
        String v = padLeft(value, 10);
        int nameWidth = COLS - 3 - 1 - 10;
        String n = name.length() > nameWidth ? name.substring(0, nameWidth) : name;
        StringBuilder sb = new StringBuilder(q).append(' ').append(n);
        while (sb.length() < COLS - 10) sb.append(' ');
        return sb.append(v).toString();
    }

    /** Junta esquerda e direita preenchendo o meio com espaço. */
    private String pad(String left, String right, int width) {
        StringBuilder sb = new StringBuilder(left);
        while (sb.length() < width - right.length()) sb.append(' ');
        return sb.append(right).toString();
    }

    private String padLeft(String s, int width) {
        StringBuilder sb = new StringBuilder();
        for (int i = s.length(); i < width; i++) sb.append(' ');
        return sb.append(s).toString();
    }

    private byte[] line(String text) throws Exception {
        // IBM850 cobre os acentos do português; sem isso "ã"/"ç" saem como lixo.
        return (text + "\n").getBytes("IBM850");
    }

    private String rule(char c) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < COLS; i++) sb.append(c);
        return sb.toString();
    }

    private String dateNow() {
        return new java.text.SimpleDateFormat("dd/MM/yyyy", new java.util.Locale("pt", "BR"))
                .format(new java.util.Date());
    }

    private String timeNow() {
        return new java.text.SimpleDateFormat("HH:mm", new java.util.Locale("pt", "BR"))
                .format(new java.util.Date());
    }

    private String money(double v) {
        return String.format(new java.util.Locale("pt", "BR"), "%.2f", v).replace('.', ',');
    }
}
