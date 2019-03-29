const request = require('request');

module.exports = async function(context, cb) {
    const {
        githubToken,
        trelloToken,
        trelloKey,
        trelloBoardId,
        trelloColumnOpen,
        trelloColumnDev,
        trelloColumnCan,
        trelloColumnRel,
    } = context.secrets;

    const {
        html_url: PRUrl,
        title: PRTitle,
        state,
        merged,
        head: { ref: headRef },
        base: { ref: baseRef },
        commits_url: commitsUrl,
    } = JSON.parse(context.body.payload).pull_request;

    if (state === 'open') {
        if (
            headRef === 'develop' ||
            headRef === 'candidate' ||
            headRef === 'release'
        ) {
            return;
        }

        const trelloShortLinks = await getTrelloShortLinks(
            commitsUrl,
            githubToken,
            trelloBoardId,
            trelloKey,
            trelloToken,
        );

        trelloShortLinks.forEach(async shortLink => {
            const attachments = await getTrelloTicketAttachment(
                shortLink,
                trelloKey,
                trelloToken,
            );
            for (const attachment of attachments) {
                if (attachment.url === PRUrl) {
                    return;
                }
            }
            await updateTrelloTicketAttachment(
                shortLink,
                trelloKey,
                trelloToken,
                {
                    name: PRTitle,
                    url: PRUrl,
                },
            );
            await moveTrelloTicketToColumn(
                shortLink,
                trelloColumnOpen,
                trelloKey,
                trelloToken,
            );
        });
    }

    if (state === 'closed' && merged) {
        const trelloShortLinks = await getTrelloShortLinks(
            commitsUrl,
            githubToken,
            trelloBoardId,
            trelloKey,
            trelloToken,
        );

        if (
            baseRef === 'develop' &&
            headRef !== 'candidate' &&
            headRef !== 'release'
        ) {
            trelloShortLinks.forEach(async shortLink => {
                await moveTrelloTicketToColumn(
                    shortLink,
                    trelloColumnDev,
                    trelloKey,
                    trelloToken,
                );
            });
        }

        if (baseRef === 'candidate' && headRef !== 'release') {
            trelloShortLinks.forEach(async shortLink => {
                await moveTrelloTicketToColumn(
                    shortLink,
                    trelloColumnCan,
                    trelloKey,
                    trelloToken,
                );
            });
        }

        if (baseRef === 'release') {
            trelloShortLinks.forEach(async shortLink => {
                await moveTrelloTicketToColumn(
                    shortLink,
                    trelloColumnRel,
                    trelloKey,
                    trelloToken,
                );
            });
        }
    }

    cb(null, {});
};

const getTrelloShortLinks = async (
    commitsUrl,
    githubToken,
    trelloBoardId,
    trelloKey,
    trelloToken,
) => {
    const commitMessages = (await getCommits(commitsUrl, githubToken)).map(
        item => item.commit.message,
    );

    const trelloIds = [
        ...new Set(
            commitMessages.reduce((ids, message) => {
                const parts = message.split(' ');
                while (true) {
                    const part = parts.shift();
                    if (!part.match(/T-[0-9]+/)) {
                        break;
                    }
                    ids.push(parseInt(part.replace('T-', '')));
                }
                return ids;
            }, []),
        ),
    ];

    const trelloTickets = await getTrelloTickets(
        trelloBoardId,
        trelloKey,
        trelloToken,
    );

    return trelloTickets
        .filter(ticket => trelloIds.includes(ticket.idShort))
        .map(ticket => ticket.shortLink);
};

const getCommits = (url, githubToken) =>
    requestPromise({
        url,
        method: 'GET',
        headers: {
            'User-Agent': 'trellobot',
            Authorization: `token ${githubToken}`,
        },
    });

const getTrelloTickets = (boardId, key, token) =>
    requestPromise({
        url: `https://api.trello.com/1/boards/${boardId}/cards/visible`,
        method: 'GET',
        qs: { token, key },
    });

const updateTrelloTicketAttachment = (shortLink, key, token, data) =>
    requestPromise({
        url: `https://api.trello.com/1/cards/${shortLink}/attachments`,
        method: 'POST',
        qs: { token, key, ...data },
    });

const getTrelloTicketAttachment = (shortLink, key, token) =>
    requestPromise({
        url: `https://api.trello.com/1/cards/${shortLink}/attachments`,
        method: 'GET',
        qs: { token, key },
    });

const moveTrelloTicketToColumn = (shortLink, value, key, token) =>
    requestPromise({
        url: `https://api.trello.com/1/cards/${shortLink}/idList`,
        method: 'PUT',
        qs: { token, key, value },
    });

const requestPromise = ({ url, method, qs = {}, headers = {} }) =>
    new Promise((resolve, reject) =>
        request({ url, method, qs, headers }, (error, result) => {
            if (error) {
                return reject(error);
            }
            resolve(JSON.parse(result.body));
        }),
    );
