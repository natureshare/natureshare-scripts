const re = /(\d+)°(\d+)′(?:(\d+)″)?(N|S|E|W)/;

export default (str) => {
    const vals = re.exec(str);
    if (vals === null) {
        return null;
    }
    let d;
    let m;
    let s;
    let b;
    if (vals.length === 5) {
        [, d, m, s, b] = vals;
    } else {
        [, d, m, b] = vals;
        s = 0;
    }
    return parseFloat(
        (
            (b === 'S' || b === 'W' ? -1 : 1) *
            (parseInt(d, 10) + parseInt(m, 10) / 60 + parseInt(s, 10) / 3600)
        ).toFixed(6),
    );
};
