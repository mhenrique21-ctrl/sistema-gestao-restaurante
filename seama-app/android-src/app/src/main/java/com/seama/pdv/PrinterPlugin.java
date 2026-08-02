package com.seama.pdv;

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
 */
@CapacitorPlugin(name = "SeamaPrinter")
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

    @PluginMethod
    public void printFichas(PluginCall call) {
        String ip = call.getString("ip", "");
        int port = call.getInt("port", 9100);
        String saleNumber = String.valueOf(call.getInt("saleNumber", 0));
        String operator = call.getString("operator", "");
        JSArray fichas = call.getArray("fichas");

        if (ip == null || ip.isEmpty()) {
            call.reject("IP da impressora não configurado");
            return;
        }
        if (fichas == null || fichas.length() == 0) {
            call.reject("Nenhuma ficha para imprimir");
            return;
        }

        List<String> names = new ArrayList<>();
        List<String> prices = new ArrayList<>();
        try {
            for (int i = 0; i < fichas.length(); i++) {
                JSObject f = JSObject.fromJSONObject(fichas.getJSONObject(i));
                names.add(f.getString("name", ""));
                Double p = f.getDouble("price");
                prices.add(formatMoney(p == null ? 0 : p));
            }
        } catch (Exception e) {
            call.reject("Fichas em formato inválido: " + e.getMessage());
            return;
        }

        // Impressão fora da thread principal: socket na UI thread trava o app.
        new Thread(() -> {
            Socket socket = null;
            try {
                socket = new Socket();
                socket.connect(new InetSocketAddress(ip, port), 5000);
                OutputStream out = socket.getOutputStream();
                for (int i = 0; i < names.size(); i++) {
                    out.write(buildFicha(names.get(i), prices.get(i), saleNumber, operator));
                }
                out.flush();
                JSObject ret = new JSObject();
                ret.put("printed", names.size());
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

    private byte[] buildFicha(String name, String price, String saleNumber, String operator) throws Exception {
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        b.write(INIT);
        b.write(CODEPAGE_850);
        b.write(ALIGN_CENTER);

        b.write(line("SEAMA"));
        b.write(line("Venda #" + saleNumber + "  " + timeNow()));
        b.write(line(dashes()));
        b.write(LF);

        // Nome do produto é a informação principal: fonte dobrada; se o nome
        // for longo, cai pra altura dobrada só, pra não estourar a largura.
        b.write(BOLD_ON);
        b.write(name.length() <= 20 ? textSize(2, 2) : textSize(1, 2));
        b.write(line(name.toUpperCase()));
        b.write(textSize(1, 1));
        b.write(BOLD_OFF);

        b.write(LF);
        b.write(textSize(1, 2));
        b.write(line(price));
        b.write(textSize(1, 1));

        b.write(LF);
        b.write(line(dashes()));
        if (operator != null && !operator.isEmpty()) b.write(line(operator));

        b.write(LF);
        b.write(LF);
        b.write(LF);
        b.write(ALIGN_LEFT);
        b.write(CUT);
        return b.toByteArray();
    }

    private byte[] line(String text) throws Exception {
        // IBM850 cobre os acentos do português; sem isso "ã"/"ç" saem como lixo.
        return (text + "\n").getBytes("IBM850");
    }

    private String dashes() {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < COLS; i++) sb.append('-');
        return sb.toString();
    }

    private String timeNow() {
        return new java.text.SimpleDateFormat("dd/MM HH:mm", new java.util.Locale("pt", "BR"))
                .format(new java.util.Date());
    }

    private String formatMoney(double v) {
        return "R$ " + String.format(new java.util.Locale("pt", "BR"), "%.2f", v).replace('.', ',');
    }
}
