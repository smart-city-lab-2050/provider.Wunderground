import express, { Response, Request } from 'express';
import Debug from 'debug';
import { getCurrentConditions } from './wunderground';
import { ProviderResponse } from './models/context';
import { ValueError, WundergroundAPIError } from './exceptions';

// Setup debug for logging and default router
const debug = Debug('provider:router');

async function handleContextRequest(req: Request, res: Response) {
    debug(
        'Received a new request to the query endpoint to deliver %o',
        req.body.attrs || 'everything',
    );
    // TODO: Make sure body is NGSIv2 conforming
    const response = new ProviderResponse();
    for (
        let i = 0, entity = req.body.entities[0];
        i < req.body.entities.length;
        i++, entity = req.body.entities[i]
    ) {
        if (entity.type !== 'WeatherObserved') {
            // This context provider only supports WeatherObserved type
            debug(
                "Unable to serve context element of type '%s'. Only type 'WeatherObserved' is supported",
                entity.type,
            );
            return res.status(400).end();
        }

        // Expected id format: urn:ngsi-ld:WeatherObserved:<Station ID>
        const stationId = entity.id.split(':')[3];
        try {
            const observation = await getCurrentConditions(stationId);
            const weatherObserved = observation.toWeatherObserved();
            response.entities.push(weatherObserved);
        } catch (e) {
            if (e instanceof ValueError) {
                // Value error thrown by models
                debug(
                    "Encountered value error while parsing api data for station id '%s'",
                    stationId,
                );
                debug('%O', e);
                // The NGSIv2 specification does not contain any server-side http error codes - use 500 and set error to identify the error thrown
                return res.status(500).json({
                    error: 'ValueError',
                    description:
                        'Encoutered a value errror while parsing the API data for the requested station id',
                });
            }
            if (e instanceof WundergroundAPIError) {
                if (e.statusCode === 404) {
                    debug(
                        "The provided station id '%s' does not exist",
                        stationId,
                    );
                    debug('%O', e);
                    return res.status(404).json({
                        error: 'NotFound',
                        description: 'The station id requested does not exist',
                    });
                }
                // API error
                debug(
                    "Encountered API error while processing query for station id '%s'",
                    stationId,
                );
                debug('%O', e);
                return res.status(500).json({
                    error: 'APIError',
                    description:
                        'Retrieving data from the API for the requested station id failed due to an invalid response from the API',
                });
            }
            if (e instanceof Error) {
                // Common error (Network?)
                debug(
                    "Encountered common error while processing query for station id '%s'",
                    stationId,
                );
                debug('%O', e);
                return res.status(500).json({
                    error: 'NetworkError',
                    description:
                        'Retrieving data from the API for the requested station id failed due to an network exception',
                });
            }

            // Unknown error
            debug(
                "Encountered unknown error while processing query for station id '%s'",
                stationId,
            );
            debug('%O', e);
            return res.status(500).json({
                error: 'UnknownError',
                description:
                    'The provider was unable to respond to the request due to an internal error',
            });
        }
    }

    // Send response back to context broker
    const preparedResponse = response.prepare(req.body.attrs);
    return res.json(preparedResponse);
}

const router = express.Router();
// Requests will contain NGSIv2 payloads in JSON format, therefore we need to parse the body using the express.json middleware
router.use(express.json());
router.post('/op/query', handleContextRequest);

export default router;
