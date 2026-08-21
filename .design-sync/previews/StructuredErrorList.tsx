import { StructuredErrorList } from '@openlinker/web';

const translate = (error: { code: string; message: string; field?: string }) => {
  if (error.code === 'RESPONSIBLE_PRODUCER_NOT_SPECIFIED') {
    return { message: "Configure a Responsible Producer entry in the connection's seller defaults." };
  }
  if (error.code === 'ConstraintViolationException.AfterSalesServiceConditionsRequiredByCompany') {
    return {
      message:
        'Set after-sales policies (returns, warranty, implied warranty) on the connection-edit page. Allegro requires them for Business Accounts.',
    };
  }
  return null;
};

export const Raw = () => (
  <StructuredErrorList
    errors={[
      {
        field: 'offer.parameters[3].valuesIds',
        code: 'ConstraintViolationException.RequiredParameter',
        message: 'Parameter "Marka" is required in category 257 and was not provided.',
      },
      {
        field: 'offer.sellingMode.price.amount',
        code: 'ConstraintViolationException.PriceOutOfRange',
        message: 'Price 0.00 PLN is below the minimum accepted for this category.',
      },
      {
        code: 'UnsupportedLanguageInAcceptLanguageHeader',
        message: 'Accept-Language header value "pl-PL,en" is not supported.',
      },
    ]}
  />
);

export const Translated = () => (
  <StructuredErrorList
    translate={translate}
    errors={[
      {
        field: 'offer.modules.productSafety.data.productsData[0].responsibleProducer',
        code: 'RESPONSIBLE_PRODUCER_NOT_SPECIFIED',
        message: 'responsibleProducer must not be null',
      },
      {
        field: 'offer.afterSalesServices.impliedWarranty',
        code: 'ConstraintViolationException.AfterSalesServiceConditionsRequiredByCompany',
        message: 'After-sales service conditions are required by company accounts.',
      },
    ]}
  />
);

export const SingleError = () => (
  <StructuredErrorList
    errors={[
      {
        field: 'ean',
        code: 'validation_error',
        message: 'EAN 590123412345 failed the GS1 check-digit test.',
      },
    ]}
  />
);

export const NoFieldAnchor = () => (
  <StructuredErrorList
    errors={[
      {
        code: 'SAFETY_INFO_NOT_DEFINED',
        message: 'Safety information is not defined for the selected category.',
      },
      {
        code: 'ProductConstraintViolationException.DataIntegrity',
        message:
          'The product card is already bound to another offer in this batch. Only the first sibling was accepted.',
      },
    ]}
  />
);
