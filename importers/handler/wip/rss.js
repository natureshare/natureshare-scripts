// import crypto from 'crypto';
import FeedParser from 'feedparser';
import fetch from 'node-fetch';
// import URL from 'url';

// const sign = (username, src) => crypto.createHash('sha256').update(username + src + process.env.FEED_SECRET).digest('hex');

export default (src) => {
    fetch(src)
        .catch((error) => console.log(error))
        .then((response) => {
            if (response.ok) {
                const feedparser = new FeedParser({
                    feedurl: src,
                });

                response.body.pipe(feedparser);

                feedparser.on('error', (error) => {
                    console.log(error);
                });

                feedparser.on('readable', () => {
                    const stream = this;
                    const { meta } = this;
                    console.log(meta);
                    let item;
                    /* eslint-disable no-cond-assign */
                    while ((item = stream.read())) {
                        // to do
                        console.log(item);
                    }
                });
            }
        });
};
