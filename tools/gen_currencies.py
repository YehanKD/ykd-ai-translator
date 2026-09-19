#!/usr/bin/env python3
"""Generate extension/data/currencies.js from the live rate API plus a
currency -> country mapping (the flag is derived from the country code).

Run:  python3 tools/gen_currencies.py
"""
import json
import urllib.request
from pathlib import Path

# currency code -> (name, symbol, representative country code, decimals)
# Decimals follow ISO 4217: 0 for currencies with no minor unit.
CUR = {
    "USD": ("US Dollar", "$", "US", 2),
    "EUR": ("Euro", "€", "EU", 2),
    "GBP": ("British Pound", "£", "GB", 2),
    "CNY": ("Chinese Yuan", "¥", "CN", 2),
    "JPY": ("Japanese Yen", "¥", "JP", 0),
    "KRW": ("South Korean Won", "₩", "KR", 0),
    "INR": ("Indian Rupee", "₹", "IN", 2),
    "LKR": ("Sri Lankan Rupee", "Rs", "LK", 2),
    "AUD": ("Australian Dollar", "A$", "AU", 2),
    "CAD": ("Canadian Dollar", "C$", "CA", 2),
    "NZD": ("New Zealand Dollar", "NZ$", "NZ", 2),
    "CHF": ("Swiss Franc", "CHF", "CH", 2),
    "HKD": ("Hong Kong Dollar", "HK$", "HK", 2),
    "SGD": ("Singapore Dollar", "S$", "SG", 2),
    "TWD": ("New Taiwan Dollar", "NT$", "TW", 2),
    "MOP": ("Macanese Pataca", "MOP$", "MO", 2),
    "MYR": ("Malaysian Ringgit", "RM", "MY", 2),
    "THB": ("Thai Baht", "฿", "TH", 2),
    "IDR": ("Indonesian Rupiah", "Rp", "ID", 0),
    "PHP": ("Philippine Peso", "₱", "PH", 2),
    "VND": ("Vietnamese Dong", "₫", "VN", 0),
    "KHR": ("Cambodian Riel", "៛", "KH", 2),
    "LAK": ("Lao Kip", "₭", "LA", 2),
    "MMK": ("Myanmar Kyat", "K", "MM", 2),
    "BND": ("Brunei Dollar", "B$", "BN", 2),
    "PKR": ("Pakistani Rupee", "₨", "PK", 2),
    "BDT": ("Bangladeshi Taka", "৳", "BD", 2),
    "NPR": ("Nepalese Rupee", "₨", "NP", 2),
    "BTN": ("Bhutanese Ngultrum", "Nu.", "BT", 2),
    "MVR": ("Maldivian Rufiyaa", "Rf", "MV", 2),
    "AFN": ("Afghan Afghani", "؋", "AF", 2),
    "IRR": ("Iranian Rial", "﷼", "IR", 2),
    "IQD": ("Iraqi Dinar", "ع.د", "IQ", 3),
    "SAR": ("Saudi Riyal", "﷼", "SA", 2),
    "AED": ("UAE Dirham", "د.إ", "AE", 2),
    "QAR": ("Qatari Riyal", "﷼", "QA", 2),
    "KWD": ("Kuwaiti Dinar", "د.ك", "KW", 3),
    "BHD": ("Bahraini Dinar", "ب.د", "BH", 3),
    "OMR": ("Omani Rial", "﷼", "OM", 3),
    "JOD": ("Jordanian Dinar", "د.ا", "JO", 3),
    "ILS": ("Israeli Shekel", "₪", "IL", 2),
    "LBP": ("Lebanese Pound", "ل.ل", "LB", 2),
    "SYP": ("Syrian Pound", "£", "SY", 2),
    "YER": ("Yemeni Rial", "﷼", "YE", 2),
    "TRY": ("Turkish Lira", "₺", "TR", 2),
    "GEL": ("Georgian Lari", "₾", "GE", 2),
    "AMD": ("Armenian Dram", "֏", "AM", 2),
    "AZN": ("Azerbaijani Manat", "₼", "AZ", 2),
    "RUB": ("Russian Ruble", "₽", "RU", 2),
    "UAH": ("Ukrainian Hryvnia", "₴", "UA", 2),
    "BYN": ("Belarusian Ruble", "Br", "BY", 2),
    "MDL": ("Moldovan Leu", "L", "MD", 2),
    "KZT": ("Kazakhstani Tenge", "₸", "KZ", 2),
    "UZS": ("Uzbekistani Som", "so'm", "UZ", 2),
    "KGS": ("Kyrgystani Som", "с", "KG", 2),
    "TJS": ("Tajikistani Somoni", "ЅМ", "TJ", 2),
    "TMT": ("Turkmenistani Manat", "m", "TM", 2),
    "MNT": ("Mongolian Tugrik", "₮", "MN", 2),
    "PLN": ("Polish Zloty", "zł", "PL", 2),
    "CZK": ("Czech Koruna", "Kč", "CZ", 2),
    "HUF": ("Hungarian Forint", "Ft", "HU", 2),
    "RON": ("Romanian Leu", "lei", "RO", 2),
    "BGN": ("Bulgarian Lev", "лв", "BG", 2),
    "HRK": ("Croatian Kuna", "kn", "HR", 2),
    "RSD": ("Serbian Dinar", "дин", "RS", 2),
    "MKD": ("Macedonian Denar", "ден", "MK", 2),
    "ALL": ("Albanian Lek", "L", "AL", 2),
    "BAM": ("Bosnian Convertible Mark", "KM", "BA", 2),
    "ISK": ("Icelandic Krona", "kr", "IS", 0),
    "NOK": ("Norwegian Krone", "kr", "NO", 2),
    "SEK": ("Swedish Krona", "kr", "SE", 2),
    "DKK": ("Danish Krone", "kr", "DK", 2),
    "BRL": ("Brazilian Real", "R$", "BR", 2),
    "ARS": ("Argentine Peso", "$", "AR", 2),
    "CLP": ("Chilean Peso", "$", "CL", 0),
    "COP": ("Colombian Peso", "$", "CO", 2),
    "PEN": ("Peruvian Sol", "S/", "PE", 2),
    "UYU": ("Uruguayan Peso", "$U", "UY", 2),
    "BOB": ("Bolivian Boliviano", "Bs.", "BO", 2),
    "PYG": ("Paraguayan Guarani", "₲", "PY", 0),
    "VES": ("Venezuelan Bolivar", "Bs", "VE", 2),
    "GYD": ("Guyanese Dollar", "$", "GY", 2),
    "SRD": ("Surinamese Dollar", "$", "SR", 2),
    "MXN": ("Mexican Peso", "$", "MX", 2),
    "GTQ": ("Guatemalan Quetzal", "Q", "GT", 2),
    "CRC": ("Costa Rican Colon", "₡", "CR", 2),
    "PAB": ("Panamanian Balboa", "B/.", "PA", 2),
    "DOP": ("Dominican Peso", "$", "DO", 2),
    "JMD": ("Jamaican Dollar", "$", "JM", 2),
    "TTD": ("Trinidad Dollar", "$", "TT", 2),
    "BBD": ("Barbadian Dollar", "$", "BB", 2),
    "BSD": ("Bahamian Dollar", "$", "BS", 2),
    "BZD": ("Belize Dollar", "$", "BZ", 2),
    "HNL": ("Honduran Lempira", "L", "HN", 2),
    "NIO": ("Nicaraguan Cordoba", "C$", "NI", 2),
    "CUP": ("Cuban Peso", "$", "CU", 2),
    "HTG": ("Haitian Gourde", "G", "HT", 2),
    "EGP": ("Egyptian Pound", "£", "EG", 2),
    "MAD": ("Moroccan Dirham", "د.م.", "MA", 2),
    "DZD": ("Algerian Dinar", "د.ج", "DZ", 2),
    "TND": ("Tunisian Dinar", "د.ت", "TN", 3),
    "LYD": ("Libyan Dinar", "ل.د", "LY", 3),
    "SDG": ("Sudanese Pound", "ج.س", "SD", 2),
    "ETB": ("Ethiopian Birr", "Br", "ET", 2),
    "KES": ("Kenyan Shilling", "KSh", "KE", 2),
    "TZS": ("Tanzanian Shilling", "TSh", "TZ", 2),
    "UGX": ("Ugandan Shilling", "USh", "UG", 0),
    "RWF": ("Rwandan Franc", "FRw", "RW", 0),
    "BIF": ("Burundian Franc", "FBu", "BI", 0),
    "CDF": ("Congolese Franc", "FC", "CD", 2),
    "NGN": ("Nigerian Naira", "₦", "NG", 2),
    "GHS": ("Ghanaian Cedi", "₵", "GH", 2),
    "XOF": ("West African CFA Franc", "CFA", "SN", 0),
    "XAF": ("Central African CFA Franc", "FCFA", "CM", 0),
    "ZAR": ("South African Rand", "R", "ZA", 2),
    "ZMW": ("Zambian Kwacha", "ZK", "ZM", 2),
    "MWK": ("Malawian Kwacha", "MK", "MW", 2),
    "MZN": ("Mozambican Metical", "MT", "MZ", 2),
    "BWP": ("Botswanan Pula", "P", "BW", 2),
    "NAD": ("Namibian Dollar", "$", "NA", 2),
    "SZL": ("Swazi Lilangeni", "L", "SZ", 2),
    "LSL": ("Lesotho Loti", "L", "LS", 2),
    "MUR": ("Mauritian Rupee", "₨", "MU", 2),
    "SCR": ("Seychellois Rupee", "₨", "SC", 2),
    "MGA": ("Malagasy Ariary", "Ar", "MG", 2),
    "KMF": ("Comorian Franc", "CF", "KM", 0),
    "DJF": ("Djiboutian Franc", "Fdj", "DJ", 0),
    "SOS": ("Somali Shilling", "Sh", "SO", 2),
    "ERN": ("Eritrean Nakfa", "Nfk", "ER", 2),
    "GMD": ("Gambian Dalasi", "D", "GM", 2),
    "GNF": ("Guinean Franc", "FG", "GN", 0),
    "LRD": ("Liberian Dollar", "$", "LR", 2),
    "SLE": ("Sierra Leonean Leone", "Le", "SL", 2),
    "CVE": ("Cape Verdean Escudo", "$", "CV", 2),
    "STN": ("Sao Tome Dobra", "Db", "ST", 2),
    "AOA": ("Angolan Kwanza", "Kz", "AO", 2),
    "FJD": ("Fijian Dollar", "$", "FJ", 2),
    "PGK": ("Papua New Guinean Kina", "K", "PG", 2),
    "SBD": ("Solomon Islands Dollar", "$", "SB", 2),
    "VUV": ("Vanuatu Vatu", "Vt", "VU", 0),
    "WST": ("Samoan Tala", "T", "WS", 2),
    "TOP": ("Tongan Paanga", "T$", "TO", 2),
    "XPF": ("CFP Franc", "₣", "PF", 0),
    "MDL2": ("", "", "", 2),  # placeholder removed below
}


def flag(country: str) -> str:
    """Regional-indicator flag from a 2-letter country code."""
    if not country or len(country) != 2:
        return ""
    return "".join(chr(0x1F1E6 + ord(c) - ord("A")) for c in country.upper())


def main() -> None:
    url = ("https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest"
           "/v1/currencies/cny.json")
    with urllib.request.urlopen(url, timeout=30) as r:
        data = json.load(r)
    live = data.get("cny", {})
    print(f"live rates: {len(live)} codes, date {data.get('date')}")

    rows = []
    missing = []
    for code, (name, symbol, country, dec) in CUR.items():
        if not name:
            continue
        key = code.lower()
        if key not in live:
            missing.append(code)
            continue
        rows.append((code, name, symbol, country, dec))

    rows.sort(key=lambda r: r[1])
    print(f"emitted: {len(rows)} currencies; not in API: {missing}")

    out = Path(__file__).resolve().parent.parent / "extension" / "data" / "currencies.js"
    out.parent.mkdir(parents=True, exist_ok=True)

    lines = [
        "/**",
        " * Supported currencies: code, name, symbol, flag, decimals.",
        " *",
        " * Generated by tools/gen_currencies.py — edit that, not this file.",
        " * The API covers ~340 codes including crypto; this list is the real",
        " * fiat currencies only, each mapped to a country so it can carry a flag.",
        " * `decimals` follows ISO 4217 (0 for currencies with no minor unit).",
        " */",
        "",
        "export const CURRENCIES = [",
    ]
    # Note: declared without `export` below and exported once at the end, so the
    # file can also be loaded as a plain content script (where `export` throws).
    lines[lines.index("export const CURRENCIES = [")] = "const CURRENCIES = ["
    for code, name, symbol, country, dec in rows:
        f = flag(country)
        lines.append(
            f'  {{ code: "{code}", name: "{name}", symbol: "{symbol}", '
            f'flag: "{f}", decimals: {dec} }},'
        )
    lines += [
        "];",
        "",
        "/** Lookup by code, e.g. findCurrency(\"LKR\"). */",
        "function findCurrency(code) {",
        "  if (!code) return null;",
        "  const upper = String(code).toUpperCase();",
        "  return CURRENCIES.find((c) => c.code === upper) ?? null;",
        "}",
        "",
        "/** Flag for a code, or \"\" when unknown. */",
        "function flagFor(code) {",
        "  return findCurrency(code)?.flag ?? \"\";",
        "}",
        "",
        "/** Default preference: Sri Lankan Rupee, matching the app's locale. */",
        'const DEFAULT_CURRENCY = "LKR";',
        "",
        "// This file is loaded BOTH as an options-page module (via import) and as a",
        "// content script, where `export` is a syntax error. Assigning to globalThis",
        "// works in both: content scripts read window.YKDCurrency, and the module",
        "// exports below satisfy the import.",
        "globalThis.YKDCurrency = { CURRENCIES, findCurrency, flagFor, DEFAULT_CURRENCY };",
        "",
        "export { CURRENCIES, findCurrency, flagFor, DEFAULT_CURRENCY };",
        "",
    ]
    # The export statement above is only valid when this file is loaded as an ES
    # module (the options page imports it). Chrome injects it as a CLASSIC
    # content script, where `export` is a SyntaxError that kills every script
    # after it in the manifest list. The build emits a second, module-free copy
    # (currencies.data.js) for that path; see tools/build_extension.sh.
    out.write_text("\n".join(lines), encoding="utf-8")
    print(f"wrote {out} ({len(lines)} lines)")

    # A module-free copy for the content-script path.
    data_lines = [ln for ln in lines if not ln.startswith("export {")]
    data_lines.insert(
        0,
        "// GENERATED — module-free copy for content scripts.",
        )
    data_lines.insert(
        1,
        "// Chrome injects content scripts as classic scripts, where `export` is a",
        )
    data_lines.insert(
        2,
        "// SyntaxError that aborts every script after this one in the manifest.",
        )
    data_lines.insert(3, "// The options page imports currencies.js instead.")
    data_out = out.with_name("currencies.data.js")
    data_out.write_text("\n".join(data_lines), encoding="utf-8")
    print(f"wrote {data_out} ({len(data_lines)} lines)")


if __name__ == "__main__":
    main()
