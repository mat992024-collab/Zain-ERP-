import sys
import hmac
import hashlib
from datetime import datetime, timedelta

SECRET_SALT = 'ZAIN-ERP-2026-SECRET-LIC-KEY-992024'

def calculate_signature(machine_id, lic_type, expiry_str):
    payload = f"{machine_id.strip().upper()}|{lic_type.lower()}|{expiry_str.strip()}".encode('utf-8')
    return hmac.new(SECRET_SALT.encode('utf-8'), payload, hashlib.sha256).hexdigest().upper()[:8]

def generate_key(machine_id, lic_type, expiry_str=None):
    machine_id = machine_id.strip().upper()
    norm_type = lic_type.lower()
    if not expiry_str:
        now = datetime.now()
        if norm_type == 'monthly':
            exp = (now + timedelta(days=30)).strftime('%Y-%m-%d')
        elif norm_type == 'yearly':
            exp = (now + timedelta(days=365)).strftime('%Y-%m-%d')
        else:
            exp = '2099-12-31'
    else:
        exp = expiry_str.strip()

    clean_id = machine_id.replace('ZAIN-', '')
    type_code = 'M' if norm_type == 'monthly' else ('Y' if norm_type == 'yearly' else 'L')
    exp_code = exp.replace('-', '')
    sig = calculate_signature(machine_id, norm_type, exp)
    return f"ZACT-{clean_id}-{type_code}{exp_code}-{sig}"

def verify_key(machine_id, key):
    if not key or not machine_id:
        return False, "البيانات غير مكتملة"
    parts = key.strip().upper().split('-')
    if len(parts) != 6 or parts[0] != 'ZACT':
        return False, "صيغة المفتاح غير صحيحة"
    key_mach = f"ZAIN-{parts[1]}-{parts[2]}-{parts[3]}"
    if key_mach != machine_id.strip().upper():
        return False, "المفتاح غير مطابق لمعرف الجهاز"
    type_code = parts[4][0]
    exp_code = parts[4][1:]
    sig = parts[5]
    lic_type = 'monthly' if type_code == 'M' else ('yearly' if type_code == 'Y' else ('lifetime' if type_code == 'L' else None))
    if not lic_type:
        return False, "نوع الترخيص غير معروف"
    exp_str = f"{exp_code[:4]}-{exp_code[4:6]}-{exp_code[6:]}" if len(exp_code) == 8 else "2099-12-31"
    expected_sig = calculate_signature(machine_id, lic_type, exp_str)
    if sig != expected_sig:
        return False, "توقيع المفتاح غير صالح"
    return True, f"صالح: {lic_type} حتى {exp_str}"

def run_gui():
    import tkinter as tk
    from tkinter import ttk, messagebox

    root = tk.Tk()
    root.title("مُولّد تراخيص زين ERP — Zain License Generator")
    root.geometry("640x700")
    root.resizable(False, False)
    root.configure(bg="#0f172a")

    style = ttk.Style()
    style.theme_use("clam")

    card = tk.Frame(root, bg="#1e293b", padx=30, pady=25, highlightbackground="#334155", highlightthickness=1)
    card.pack(fill="both", expand=True, padx=25, pady=25)

    title = tk.Label(card, text="🛡️ مُولّد تراخيص نظام زين ERP", font=("Cairo", 18, "bold"), fg="#38bdf8", bg="#1e293b")
    title.pack(pady=(0, 5))

    sub = tk.Label(card, text="توليد مفاتيح التفعيل المعتمدة (شهري / سنوي / مدى الحياة)", font=("Cairo", 10), fg="#94a3b8", bg="#1e293b")
    sub.pack(pady=(0, 20))

    lbl_mach = tk.Label(card, text="معرّف الجهاز المطلوب (Machine ID):", font=("Cairo", 11, "bold"), fg="#f1f5f9", bg="#1e293b", anchor="e")
    lbl_mach.pack(fill="x", pady=(5, 3))

    ent_mach = tk.Entry(card, font=("Consolas", 12, "bold"), bg="#0f172a", fg="#38bdf8", insertbackground="#38bdf8", relief="flat", highlightbackground="#475569", highlightthickness=1)
    ent_mach.pack(fill="x", ipady=8, pady=(0, 15))
    ent_mach.insert(0, "ZAIN-")

    lbl_type = tk.Label(card, text="نوع الترخيص ومدة الصلاحية:", font=("Cairo", 11, "bold"), fg="#f1f5f9", bg="#1e293b", anchor="e")
    lbl_type.pack(fill="x", pady=(5, 5))

    type_var = tk.StringVar(value="yearly")

    radio_frame = tk.Frame(card, bg="#1e293b")
    radio_frame.pack(fill="x", pady=(0, 15))

    types = [
        ("مدى الحياة 🌟 (دائم)", "lifetime"),
        ("ترخيص سنوي 📅 (365 يوم)", "yearly"),
        ("ترخيص شهري 📆 (30 يوم)", "monthly"),
    ]

    for label_text, val in types:
        r = tk.Radiobutton(
            radio_frame, text=label_text, value=val, variable=type_var,
            font=("Cairo", 10), fg="#e2e8f0", bg="#1e293b",
            activebackground="#1e293b", activeforeground="#38bdf8",
            selectcolor="#0f172a", anchor="e", justify="right"
        )
        r.pack(fill="x", pady=2)

    lbl_result = tk.Label(card, text="رمز التفعيل الناتج (License Key):", font=("Cairo", 11, "bold"), fg="#f1f5f9", bg="#1e293b", anchor="e")
    lbl_result.pack(fill="x", pady=(10, 3))

    ent_result = tk.Entry(card, font=("Consolas", 11, "bold"), bg="#0f172a", fg="#4ade80", insertbackground="#4ade80", relief="flat", highlightbackground="#475569", highlightthickness=1)
    ent_result.pack(fill="x", ipady=10, pady=(0, 15))

    status_lbl = tk.Label(card, text="", font=("Cairo", 10), fg="#38bdf8", bg="#1e293b")
    status_lbl.pack(pady=(0, 15))

    def on_generate():
        m_id = ent_mach.get().strip().upper()
        if not m_id or m_id == "ZAIN-" or len(m_id) < 10:
            messagebox.showwarning("تنبيه", "يرجى إدخال معرّف الجهاز (Machine ID) أولاً بصيغة ZAIN-XXXX-XXXX-XXXX")
            return
        t = type_var.get()
        key = generate_key(m_id, t)
        ent_result.delete(0, tk.END)
        ent_result.insert(0, key)
        status_lbl.config(text=f"✅ تم توليد الرمز بنجاح لنظام ({t})!", fg="#4ade80")

    def on_copy():
        k = ent_result.get().strip()
        if not k:
            messagebox.showinfo("تنبيه", "لا يوجد رمز منسوخ، اضغط توليد أولاً")
            return
        root.clipboard_clear()
        root.clipboard_append(k)
        status_lbl.config(text="📋 تم نسخ رمز التفعيل إلى الحافظة بنجاح!", fg="#38bdf8")

    btn_frame = tk.Frame(card, bg="#1e293b")
    btn_frame.pack(fill="x", pady=(5, 0))

    btn_gen = tk.Button(btn_frame, text="⚡ توليد رمز التفعيل", font=("Cairo", 12, "bold"), bg="#2563eb", fg="#ffffff", activebackground="#1d4ed8", activeforeground="#ffffff", relief="flat", cursor="hand2", command=on_generate)
    btn_gen.pack(side="left", expand=True, fill="x", padx=(0, 5), ipady=6)

    btn_copy = tk.Button(btn_frame, text="📋 نسخ الرمز", font=("Cairo", 12, "bold"), bg="#10b981", fg="#ffffff", activebackground="#059669", activeforeground="#ffffff", relief="flat", cursor="hand2", command=on_copy)
    btn_copy.pack(side="right", expand=True, fill="x", padx=(5, 0), ipady=6)

    root.mainloop()

if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == '--cli':
        import argparse
        parser = argparse.ArgumentParser(description="Zain ERP License Key Generator")
        parser.add_argument("--machine", required=True, help="Machine ID (ZAIN-XXXX-XXXX-XXXX)")
        parser.add_argument("--type", choices=["monthly", "yearly", "lifetime"], default="yearly", help="License type")
        parser.add_argument("--expiry", default=None, help="Custom expiry (YYYY-MM-DD)")
        args = parser.parse_args(sys.argv[2:])
        print(generate_key(args.machine, args.type, args.expiry))
    else:
        run_gui()
